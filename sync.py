"""Orquestra a sincronização com o banco da empresa: abertas + frota (síncrono, rápido)
e histórico incremental (em thread de background — a janela completa é grande demais
pra um request síncrono, mesmo limite de timeout de proxy já documentado no projeto CTT)."""

import json
import threading
from datetime import datetime, timedelta

import business
import mariadb_client
from models import ORIGEM_BANCO, Frota, Meta, OsAberta, OsHistorico, RegraClassificacao, db

HISTORICO_BACKFILL_DIAS = 120
MARGEM_SEGURANCA_MIN = 5

_status = {"status": "idle"}


def get_status():
    return dict(_status)


def _set_status(**kw):
    _status.clear()
    _status.update(kw)


def sync_abertas_e_frota():
    """Síncrono: poucas centenas de linhas, ~2-3s medido contra o banco real."""
    abertas = mariadb_client.fetch_os_abertas()
    frota = mariadb_client.fetch_frota()

    OsAberta.query.filter_by(origem=ORIGEM_BANCO).delete()
    for a in abertas:
        db.session.add(OsAberta(
            os=a["os"], veic=a["veic"], desc=a["desc"], esp=a["esp"], mod=a["mod"],
            marca=a["marca"], agr=a["agr"], ofic=a["ofic"], mt=a["mt"], tp=a["tp"],
            ab=a["ab"], prob=a["prob"], sol=a["sol"], prog=a["prog"], origem=ORIGEM_BANCO,
            atualizado_em=datetime.utcnow(),
        ))

    Frota.query.delete()
    for f in frota:
        db.session.add(Frota(
            codigo=f["codigo"], modelo=f["modelo"], especialidade=f["especialidade"],
            agrupamento=f["agrupamento"], ativo=f["ativo"],
        ))

    db.session.commit()
    return {"abertas": len(abertas), "frota": len(frota)}


def _get_meta(chave, default=None):
    row = db.session.get(Meta, chave)
    return row.valor if row else default


def _set_meta(chave, valor):
    row = db.session.get(Meta, chave)
    if not row:
        row = Meta(chave=chave)
        db.session.add(row)
    row.valor = valor


LOTE = 500


def _regras_customizadas():
    return [r.to_dict() for r in RegraClassificacao.query.all()]


def _frota_especialidade_map():
    return dict(db.session.query(Frota.codigo, Frota.especialidade).all())


def _classificar(texto, esp, regras):
    """Principal + todos os problemas da descrição, já serializados pro banco."""
    itens = business.classificar_itens(texto, esp, regras)
    sis, prob = business.classificar_principal(texto, esp, regras)
    return sis, prob, json.dumps([[i["s"], i["p"]] for i in itens], ensure_ascii=False)


def reclassificar_historico():
    """Recalcula sistema/problema de todo o histórico — chamado quando uma regra
    customizada nova é criada/removida na tela de Classificação (as ~60 regras fixas
    nunca mudam, só as customizadas justificam reprocessar tudo)."""
    esp_map = _frota_especialidade_map()
    regras = _regras_customizadas()
    total = 0
    for h in OsHistorico.query.yield_per(500):
        h.sistema, h.problema, h.itens = _classificar(h.texto, esp_map.get(h.veic, ""), regras)
        total += 1
    db.session.commit()
    return total


def _upsert_historico(rows):
    """Upsert em lotes — evita 1 SELECT por linha (N+1), que numa carga inicial de
    dezenas de milhares de registros deixava a sincronização visivelmente lenta."""
    esp_map = _frota_especialidade_map()
    regras = _regras_customizadas()
    novos = 0
    for inicio in range(0, len(rows), LOTE):
        lote = rows[inicio:inicio + LOTE]
        ids = [r["os"] for r in lote]
        existentes = {
            row[0] for row in
            db.session.query(OsHistorico.os).filter(OsHistorico.os.in_(ids)).all()
        }
        for r in lote:
            sis, prob, itens = _classificar(r["texto"], esp_map.get(r["veic"], ""), regras)
            if r["os"] in existentes:
                db.session.query(OsHistorico).filter_by(os=r["os"]).update({
                    "veic": r["veic"], "data_abertura": r["data_abertura"],
                    "data_liberacao": r["data_liberacao"], "horas_parada": r["horas_parada"],
                    "texto": r["texto"], "tipo_manutencao": r["tipo_manutencao"],
                    "sistema": sis, "problema": prob, "itens": itens,
                })
            else:
                db.session.add(OsHistorico(
                    os=r["os"], veic=r["veic"], data_abertura=r["data_abertura"],
                    data_liberacao=r["data_liberacao"], horas_parada=r["horas_parada"],
                    texto=r["texto"], tipo_manutencao=r["tipo_manutencao"],
                    sistema=sis, problema=prob, itens=itens,
                ))
                novos += 1
        db.session.flush()
    return novos


def _sync_historico(app):
    with app.app_context():
        try:
            checkpoint = _get_meta("historico_sync_ate")
            desde = (
                datetime.fromisoformat(checkpoint) if checkpoint
                else datetime.utcnow() - timedelta(days=HISTORICO_BACKFILL_DIAS)
            )
            # hora capturada ANTES da consulta, com margem de segurança: garante que a
            # próxima sincronização revê uma pequena sobreposição em vez de arriscar
            # perder um registro que fechou durante a busca (upsert é idempotente).
            marca_tempo = datetime.now() - timedelta(minutes=MARGEM_SEGURANCA_MIN)

            rows = mariadb_client.fetch_os_historico(desde)
            novos = _upsert_historico(rows)
            _set_meta("historico_sync_ate", marca_tempo.isoformat())
            db.session.commit()

            _set_status(
                status="concluido", total=len(rows), novos=novos,
                desde=desde.isoformat(), concluido_em=datetime.utcnow().isoformat(),
            )
        except Exception as exc:
            db.session.rollback()
            _set_status(status="erro", mensagem=str(exc))


def disparar_sync_historico(app):
    _set_status(status="processando")
    threading.Thread(target=_sync_historico, args=(app,), daemon=True).start()
