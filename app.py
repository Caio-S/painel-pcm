import json
import os
from datetime import datetime, timedelta

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from sqlalchemy import inspect, text

import business
import sync
from models import (
    Contato,
    Frota,
    FrotaAlocacao,
    Meta,
    OsAberta,
    OsDetalhe,
    OsHistorico,
    OsRetorno,
    ORIGEM_MANUAL,
    RegraClassificacao,
    db,
)

load_dotenv()

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
default_sqlite = "sqlite:///" + os.path.join(BASE_DIR, "painel_pcm.db")
db_url = os.environ.get("DATABASE_URL") or default_sqlite
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)
elif db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = db_url
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_pre_ping": True,
    "pool_size": 3,
    "max_overflow": 2,
    "pool_recycle": 300,
    # pooler do Supabase (PgBouncer) troca a conexão física por trás da mesma sessão;
    # sem isso o psycopg tenta reusar prepared statements que não existem mais e quebra.
    "connect_args": {"prepare_threshold": None} if db_url.startswith("postgresql+psycopg://") else {},
}
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev")
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=14)

db.init_app(app)


def _migrar():
    """db.create_all() cria tabela nova mas não coluna nova em tabela que já existe —
    o histórico em produção tem dezenas de milhares de linhas e não dá pra recriar."""
    insp = inspect(db.engine)
    if not insp.has_table("pcm_os_historico"):
        return
    colunas = {c["name"] for c in insp.get_columns("pcm_os_historico")}
    if "itens" not in colunas:
        db.session.execute(text("ALTER TABLE pcm_os_historico ADD COLUMN itens TEXT"))
        db.session.commit()


with app.app_context():
    db.create_all()
    _migrar()


def get_meta(chave, default=None):
    row = db.session.get(Meta, chave)
    return row.valor if row else default


def set_meta(chave, valor):
    row = db.session.get(Meta, chave)
    if not row:
        row = Meta(chave=chave)
        db.session.add(row)
    row.valor = valor


@app.url_defaults
def _versao_do_estatico(endpoint, values):
    """Carimba ?v=<mtime> em todo url_for('static'). Sem isso o navegador segurava
    o core.js antigo depois do deploy e a tela continuava com o comportamento
    velho, mesmo com o código novo no ar."""
    if endpoint != "static" or "filename" not in values:
        return
    try:
        values["v"] = int(os.stat(os.path.join(app.static_folder, values["filename"])).st_mtime)
    except OSError:
        pass


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health")
def health():
    return jsonify({"ok": True})


@app.route("/api/sync/atualizar", methods=["POST"])
def api_sync_atualizar():
    try:
        resultado = sync.sync_abertas_e_frota()
    except Exception as exc:
        return jsonify({"error": f"Falha ao consultar o banco da empresa: {exc}"}), 502
    sync.disparar_sync_historico(app)
    return jsonify({
        "abertas": resultado["abertas"], "frota": resultado["frota"], "historico": "processando",
    }), 202


@app.route("/api/sync/status")
def api_sync_status():
    return jsonify(sync.get_status())


# =============== configuração / constantes ===============

DEFAULT_SLA = 3
DEFAULT_REINC_DIAS = 30
DEFAULT_TV_SEG = 22


def _config():
    return {
        "sla": float(get_meta("sla", DEFAULT_SLA)),
        "reincDias": int(float(get_meta("reincDias", DEFAULT_REINC_DIAS))),
        "groupBy": get_meta("groupBy", "frente"),
        "tvSeg": int(float(get_meta("tvSeg", DEFAULT_TV_SEG))),
    }


@app.route("/api/constants")
def api_constants():
    return jsonify({
        "familias": business.FAMILIAS, "sisLista": business.SIS_LISTA,
        "probLista": business.PROB_LISTA, "classes": business.CLASSES,
        "acoes": business.ACOES, "grupoLbl": business.GRUPO_LBL,
    })


@app.route("/api/config", methods=["GET"])
def api_config_get():
    return jsonify(_config())


@app.route("/api/config", methods=["PUT"])
def api_config_put():
    payload = request.get_json(force=True) or {}
    if "sla" in payload:
        set_meta("sla", str(payload["sla"]))
    if "reincDias" in payload:
        set_meta("reincDias", str(payload["reincDias"]))
    if "groupBy" in payload:
        set_meta("groupBy", payload["groupBy"] or "")
    if "tvSeg" in payload:
        set_meta("tvSeg", str(payload["tvSeg"]))
    db.session.commit()
    return jsonify(_config())


# =============== O.S. — leitura enriquecida ===============


def _regras_customizadas():
    return [r.to_dict() for r in RegraClassificacao.query.all()]


def _frente_label(aloc):
    if not aloc:
        return ""
    return f"{aloc.atividade or ''} {aloc.frente or ''}".strip()


def _vazio_detalhe_dict(os_num):
    return OsDetalhe(os=os_num).to_dict()


@app.route("/api/os")
def api_os_list():
    cfg = _config()
    regras = _regras_customizadas()
    aloc_por_frota = {a.codigo: a for a in FrotaAlocacao.query.all()}
    detalhes_por_os = {d.os: d for d in OsDetalhe.query.all()}

    # só o histórico das frotas que têm O.S. aberta: reincidência, retrabalho e o
    # aviso de "sem histórico" são todos por frota e só saem daqui pras O.S. abertas.
    # Trazer a tabela inteira (dezenas de milhares de linhas) derrubava a conexão
    # do pooler no meio do SELECT e o painel voltava 500.
    veics = [v for (v,) in db.session.query(OsAberta.veic).distinct()]
    hist_rows = db.session.query(
        OsHistorico.os, OsHistorico.veic, OsHistorico.data_abertura,
        OsHistorico.horas_parada, OsHistorico.sistema, OsHistorico.problema,
        OsHistorico.texto, OsHistorico.itens,
    ).filter(OsHistorico.veic.in_(veics)).all() if veics else []

    def _itens_hist(h):
        return json.loads(h.itens) if h.itens else [[h.sistema, h.problema]]

    eventos_por_frota = {}
    for h in hist_rows:
        eventos_por_frota.setdefault(h.veic, []).append({
            "os": h.os, "veic": h.veic, "d": h.data_abertura,
            "t": h.horas_parada or 0, "s": h.sistema, "p": h.problema, "x": h.texto,
            "itens": _itens_hist(h),
        })
    frotas_com_historico = {h.veic for h in hist_rows}

    abertas = OsAberta.query.order_by(OsAberta.ab).all()
    resultado = []
    for o in abertas:
        d = detalhes_por_os.get(o.os)
        det_dict = d.to_dict() if d else _vazio_detalhe_dict(o.os)
        itens = business.classificar_itens(o.prob, o.esp, regras)
        sis, prob = business.classificar_principal(o.prob, o.esp, regras)

        eventos_por_frota.setdefault(o.veic, []).append({
            "os": o.os, "veic": o.veic, "d": o.ab, "t": 0, "s": sis, "p": prob, "x": o.prob,
            "itens": itens,
        })

        a = aloc_por_frota.get(o.veic)
        item = dict(o.to_dict())
        item.update(det_dict)
        item["sisC"], item["probC"] = sis, prob
        item["itensC"] = itens
        item["ativ"] = a.atividade if a else ""
        item["fr"] = a.frente if a else ""
        item["respFr"] = a.responsavel if a else ""
        # o responsável não é mais digitado por O.S.: vem do responsável da frente,
        # cadastrado uma vez em Alocação de frota. Resolvido aqui pra valer igual no
        # painel, na TV, no PDF, na cobrança e no agrupamento por responsável.
        item["resp"] = item["resp"] or item["respFr"]
        item["frente"] = _frente_label(a) or "SEM FRENTE DEFINIDA"
        item["semHistorico"] = o.veic not in frotas_com_historico
        item["_ab_dt"] = o.ab
        resultado.append(item)

    for item in resultado:
        evento = {
            "os": item["os"], "veic": item["veic"], "d": item["_ab_dt"],
            "s": item["sisC"], "p": item["probC"], "itens": item["itensC"],
        }
        r = business.calcular_reincidencia(evento, eventos_por_frota, cfg["reincDias"])
        item["reinc"] = None
        if r:
            item["reinc"] = {
                "n": r["n"], "voltaEm": r["voltaEm"], "horas": r["horas"], "pares": r["pares"],
                "ant": [{"os": h["os"], "d": h["d"].isoformat(), "t": h["t"], "x": h["x"]} for h in r["ant"][:8]],
            }
        del item["_ab_dt"]

    retrabalho = business.calcular_retrabalho(
        [{"veic": h.veic, "d": h.data_abertura, "t": h.horas_parada or 0,
          "s": h.sistema, "p": h.problema, "itens": _itens_hist(h)} for h in hist_rows],
        cfg["reincDias"],
    )
    for item in resultado:
        rt = retrabalho.get(item["veic"])
        item["retrabalho"] = rt if rt and rt["n"] >= 3 else None

    return jsonify(resultado)


@app.route("/api/os/encerradas")
def api_os_encerradas():
    limite = min(int(request.args.get("limite", 200)), 1000)
    rows = (
        OsHistorico.query.order_by(OsHistorico.data_liberacao.desc().nullslast())
        .limit(limite).all()
    )
    detalhes_por_os = {d.os: d for d in OsDetalhe.query.filter(
        OsDetalhe.os.in_([r.os for r in rows])
    ).all()}
    out = []
    for h in rows:
        item = h.to_dict()
        d = detalhes_por_os.get(h.os)
        if d:
            item.update(d.to_dict())
        out.append(item)
    return jsonify(out)


# =============== O.S. — mutação da ficha ===============


def _get_or_create_detalhe(os_num):
    d = db.session.get(OsDetalhe, os_num)
    if not d:
        d = OsDetalhe(os=os_num)
        db.session.add(d)
    return d


@app.route("/api/os", methods=["POST"])
def api_os_nova():
    payload = request.get_json(force=True) or {}
    os_num = str(payload.get("os") or "").strip()
    veic = str(payload.get("veic") or "").strip()
    prob = str(payload.get("prob") or "").strip()
    if not os_num or not veic:
        return jsonify({"error": "Informe o número da O.S. e a frota."}), 400
    if db.session.get(OsAberta, os_num):
        return jsonify({"error": "Essa O.S. já está na lista."}), 409

    o = OsAberta(
        os=os_num, veic=veic, desc="", esp="CADASTRO MANUAL", mod="", marca="",
        agr="CADASTRO MANUAL", ofic="—", mt="CORRETIVA", tp="O.S. INTERNA",
        ab=datetime.utcnow(), prob=prob, sol="", prog="", origem=ORIGEM_MANUAL,
    )
    db.session.add(o)
    db.session.commit()
    return jsonify(o.to_dict()), 201


@app.route("/api/os/<os_num>", methods=["PATCH"])
def api_os_patch(os_num):
    if not db.session.get(OsAberta, os_num):
        return jsonify({"error": "O.S. não encontrada."}), 404
    payload = request.get_json(force=True) or {}
    d = _get_or_create_detalhe(os_num)

    if "classe" in payload:
        d.classe = payload["classe"] or "NAO"
    if "detalhe" in payload:
        d.detalhe = payload["detalhe"] or ""
    if "prevLib" in payload:
        d.prev_lib = datetime.fromisoformat(payload["prevLib"]) if payload["prevLib"] else None

    item = payload.get("item") or {}
    if "peca" in item: d.item_peca = item["peca"] or ""
    if "sol" in item: d.item_sol = item["sol"] or ""
    if "solData" in item: d.item_sol_data = _parse_date(item["solData"])
    if "ped" in item: d.item_ped = item["ped"] or ""
    if "pedData" in item: d.item_ped_data = _parse_date(item["pedData"])
    if "acao" in item: d.item_acao = item["acao"] or ""
    if "acaoResp" in item: d.item_acao_resp = item["acaoResp"] or ""
    if "previsao" in item: d.item_previsao = _parse_date(item["previsao"])
    if "fornec" in item: d.item_fornec = item["fornec"] or ""

    mo = payload.get("mo") or {}
    if "mecanico" in mo: d.mo_mecanico = mo["mecanico"] or ""
    if "causa" in mo: d.mo_causa = mo["causa"] or ""

    # alocação não se mexe daqui: é da frota, não da O.S., e tem tela e endpoints
    # próprios (/api/frota/<codigo>/alocacao). Editar por O.S. apagava o local, que
    # a ficha nem mostrava.
    db.session.commit()
    return jsonify(d.to_dict())


def _parse_date(s):
    if not s:
        return None
    return datetime.fromisoformat(s[:10]).date()


@app.route("/api/os/<os_num>/retorno", methods=["POST"])
def api_os_retorno(os_num):
    if not db.session.get(OsAberta, os_num):
        return jsonify({"error": "O.S. não encontrada."}), 404
    payload = request.get_json(force=True) or {}
    txt = (payload.get("txt") or "").strip()
    if not txt:
        return jsonify({"error": "Escreva o retorno antes de adicionar."}), 400
    d = _get_or_create_detalhe(os_num)
    db.session.add(OsRetorno(os=os_num, em=datetime.utcnow(), txt=txt, autor=(payload.get("autor") or "PCM").strip() or "PCM"))
    db.session.commit()
    d = db.session.get(OsDetalhe, os_num)
    return jsonify(d.to_dict())


@app.route("/api/os/<os_num>/encerrar", methods=["POST"])
def api_os_encerrar(os_num):
    if not db.session.get(OsAberta, os_num):
        return jsonify({"error": "O.S. não encontrada."}), 404
    d = _get_or_create_detalhe(os_num)
    d.aberta = False
    d.encerrada = datetime.utcnow()
    db.session.add(OsRetorno(os=os_num, em=d.encerrada, txt="O.S. encerrada — equipamento liberado.", autor="PCM"))
    db.session.commit()
    return jsonify(d.to_dict())


@app.route("/api/os/<os_num>/cobrar", methods=["POST"])
def api_os_cobrar(os_num):
    if not db.session.get(OsAberta, os_num):
        return jsonify({"error": "O.S. não encontrada."}), 404
    payload = request.get_json(force=True) or {}
    destinatarios = payload.get("destinatarios") or []
    d = _get_or_create_detalhe(os_num)
    d.cobrado = datetime.utcnow()
    txt = "Cobrança de reincidência enviada"
    if destinatarios:
        txt += " para " + ", ".join(destinatarios)
    txt += " — aguardando explicação da causa raiz."
    db.session.add(OsRetorno(os=os_num, em=d.cobrado, txt=txt, autor="PCM"))
    db.session.commit()
    return jsonify(d.to_dict())


@app.route("/api/os/<os_num>", methods=["DELETE"])
def api_os_excluir(os_num):
    d = db.session.get(OsDetalhe, os_num)
    if d:
        db.session.delete(d)
    o = OsAberta.query.filter_by(os=os_num, origem=ORIGEM_MANUAL).first()
    if o:
        db.session.delete(o)
    db.session.commit()
    return "", 204


# =============== frota / alocação ===============


@app.route("/api/frota")
def api_frota_list():
    aloc_por_frota = {a.codigo: a for a in FrotaAlocacao.query.all()}
    out = []
    for f in Frota.query.order_by(Frota.codigo).all():
        d = f.to_dict()
        a = aloc_por_frota.get(f.codigo)
        d["aloc"] = a.to_dict() if a else {"c": f.codigo, "ativ": "", "fr": "", "resp": "", "loc": ""}
        out.append(d)
    return jsonify(out)


def _aloc_dict(codigo):
    a = db.session.get(FrotaAlocacao, codigo)
    return a.to_dict() if a else {"c": codigo, "ativ": "", "fr": "", "resp": "", "loc": ""}


@app.route("/api/frota/<codigo>/historico")
def api_frota_historico(codigo):
    f = db.session.get(Frota, codigo)
    hist = OsHistorico.query.filter_by(veic=codigo).order_by(OsHistorico.data_abertura.desc()).all()
    abertas = OsAberta.query.filter_by(veic=codigo).order_by(OsAberta.ab.desc()).all()
    cfg = _config()
    historico_dicts = [
        {"veic": h.veic, "d": h.data_abertura, "t": h.horas_parada or 0,
         "s": h.sistema, "p": h.problema, "itens": h.lista_itens()}
        for h in hist
    ]
    rt = business.calcular_retrabalho(historico_dicts, cfg["reincDias"])
    return jsonify({
        "codigo": codigo,
        "frota": f.to_dict() if f else None,
        "aloc": _aloc_dict(codigo),
        "retrabalho": rt.get(codigo),
        "abertas": [o.to_dict() for o in abertas],
        "historico": [h.to_dict() for h in hist[:200]],
    })


@app.route("/api/frota/<codigo>/alocacao", methods=["PUT"])
def api_frota_alocacao(codigo):
    payload = request.get_json(force=True) or {}
    ativ = (payload.get("ativ") or "").strip()
    fr = (payload.get("fr") or "").strip()
    resp = (payload.get("resp") or "").strip()
    loc = (payload.get("loc") or "").strip()
    a = db.session.get(FrotaAlocacao, codigo)
    if not any([ativ, fr, resp, loc]):
        if a:
            db.session.delete(a)
    else:
        if not a:
            a = FrotaAlocacao(codigo=codigo)
            db.session.add(a)
        a.atividade, a.frente, a.responsavel, a.local = ativ, fr, resp, loc
    db.session.commit()
    return jsonify(_aloc_dict(codigo))


@app.route("/api/frota/alocacao/bulk", methods=["POST"])
def api_frota_alocacao_bulk():
    payload = request.get_json(force=True) or {}
    codigos = payload.get("codigos") or []
    ativ, fr, resp, loc = payload.get("ativ") or "", payload.get("fr") or "", payload.get("resp") or "", payload.get("loc") or ""
    if not any([ativ, fr, resp, loc]):
        return jsonify({"error": "Preencha atividade, frente, local ou responsável antes de aplicar."}), 400
    for c in codigos:
        a = db.session.get(FrotaAlocacao, c)
        if not a:
            a = FrotaAlocacao(codigo=c)
            db.session.add(a)
        if ativ: a.atividade = ativ
        if fr: a.frente = fr
        if resp: a.responsavel = resp
        if loc: a.local = loc
    db.session.commit()
    return jsonify({"atualizadas": len(codigos)})


@app.route("/api/frota/alocacao/limpar", methods=["POST"])
def api_frota_alocacao_limpar():
    payload = request.get_json(force=True) or {}
    codigos = payload.get("codigos") or []
    FrotaAlocacao.query.filter(FrotaAlocacao.codigo.in_(codigos)).delete(synchronize_session=False)
    db.session.commit()
    return jsonify({"limpas": len(codigos)})


# =============== contatos ===============


@app.route("/api/contatos", methods=["GET"])
def api_contatos_list():
    return jsonify([c.to_dict() for c in Contato.query.order_by(Contato.nome).all()])


@app.route("/api/contatos", methods=["PUT"])
def api_contatos_upsert():
    payload = request.get_json(force=True) or {}
    nome = (payload.get("nome") or "").strip().upper()
    if not nome:
        return jsonify({"error": "Informe o nome do responsável."}), 400
    tel = (payload.get("tel") or "").strip()
    funcao = (payload.get("funcao") or "").strip()
    email = (payload.get("email") or "").strip()
    fixo = bool(payload.get("fixo"))
    c = db.session.get(Contato, nome)
    if not any([tel, funcao, email, fixo]):
        if c:
            db.session.delete(c)
            db.session.commit()
        return "", 204
    if not c:
        c = Contato(nome=nome)
        db.session.add(c)
    c.tel, c.funcao, c.email, c.fixo = tel, funcao, email, fixo
    db.session.commit()
    return jsonify(c.to_dict())


# =============== classificação ===============


def _frota_especialidade_map():
    return dict(db.session.query(Frota.codigo, Frota.especialidade).all())


def _historico_e_abertas_para_classificacao():
    esp_map = _frota_especialidade_map()
    hist_rows = db.session.query(
        OsHistorico.texto, OsHistorico.veic, OsHistorico.horas_parada, OsHistorico.sistema,
    ).all()
    historico = [
        {"texto": h.texto, "veic": h.veic, "horas_parada": h.horas_parada, "sistema": h.sistema,
         "esp": esp_map.get(h.veic, "")}
        for h in hist_rows
    ]
    regras = _regras_customizadas()
    abertas = []
    for o in OsAberta.query.all():
        sis, _ = business.classificar_principal(o.prob, o.esp, regras)
        abertas.append({"prob": o.prob, "veic": o.veic, "sisC": sis, "esp": o.esp})
    return historico, abertas


@app.route("/api/classificacao/pendentes")
def api_classificacao_pendentes():
    fam = request.args.get("fam") or None
    busca = request.args.get("busca") or None
    historico, abertas = _historico_e_abertas_para_classificacao()
    return jsonify(business.clusters_nao_classificados(historico, abertas, fam, busca))


@app.route("/api/classificacao/cobertura")
def api_classificacao_cobertura():
    historico, abertas = _historico_e_abertas_para_classificacao()
    return jsonify(business.cobertura(historico, abertas))


@app.route("/api/regras", methods=["GET"])
def api_regras_list():
    return jsonify(_regras_customizadas())


@app.route("/api/regras", methods=["POST"])
def api_regras_criar():
    payload = request.get_json(force=True) or {}
    termo = business.norm(payload.get("termo") or "")
    sis = (payload.get("s") or "").strip()
    prob = (payload.get("p") or "").strip()
    fam = payload.get("fam") or "*"
    if not termo or not sis or not prob:
        return jsonify({"error": "Preencha termo, sistema e problema."}), 400
    r = RegraClassificacao(termo=termo, familia=fam, sistema=sis, problema=prob)
    db.session.add(r)
    db.session.commit()
    afetados = sync.reclassificar_historico()
    return jsonify({"regra": r.to_dict(), "reclassificados": afetados}), 201


@app.route("/api/regras/<int:regra_id>", methods=["DELETE"])
def api_regras_excluir(regra_id):
    r = db.session.get(RegraClassificacao, regra_id)
    if r:
        db.session.delete(r)
        db.session.commit()
    sync.reclassificar_historico()
    return "", 204


if __name__ == "__main__":
    app.run(debug=True, port=5003)
