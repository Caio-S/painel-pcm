"""Aplica data/alocacao_frota.json na tabela pcm_frota_alocacao.

A alocação (atividade / frente / local / responsável da frente) é lançada à mão
no painel; este script faz a carga em lote a partir dos relatórios de
disponibilidade de frota do PCM, que é como a alocação chega hoje.

    python seed_alocacao.py --dry-run   # só mostra o que mudaria
    python seed_alocacao.py             # grava

Sem DATABASE_URL no ambiente escreve no SQLite local, igual ao app.py.
"""
import argparse
import json
import os

from app import app
from models import FrotaAlocacao, db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ARQUIVO = os.path.join(BASE_DIR, "data", "alocacao_frota.json")

CAMPOS = (("atividade", "atividade"), ("frente", "frente"),
          ("local", "local"), ("responsavel", "responsavel"))


def carregar():
    with open(ARQUIVO, encoding="utf-8") as fh:
        return json.load(fh)


def aplicar(dry_run=False):
    dados = carregar()
    novas = alteradas = iguais = 0

    for item in dados["frotas"]:
        codigo = item["codigo"]
        aloc = db.session.get(FrotaAlocacao, codigo)
        if not aloc:
            aloc = FrotaAlocacao(codigo=codigo)
            db.session.add(aloc)
            novas += 1
            mudou = True
        else:
            mudou = any((getattr(aloc, attr) or "") != item[chave] for chave, attr in CAMPOS)
            if mudou:
                alteradas += 1
                print(f"  {codigo}: "
                      f"{aloc.atividade or '-'} / {aloc.frente or '-'} / {aloc.local or '-'}"
                      f"  ->  {item['atividade']} / {item['frente'] or '-'} / {item['local']}")
            else:
                iguais += 1
        if mudou:
            for chave, attr in CAMPOS:
                setattr(aloc, attr, item[chave])

    if dry_run:
        db.session.rollback()
    else:
        db.session.commit()

    print(f"\nrelatório de {dados['data_relatorio']}: {len(dados['frotas'])} frotas")
    print(f"novas: {novas}  alteradas: {alteradas}  sem mudança: {iguais}")
    if dry_run:
        print("(dry-run — nada foi gravado)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="não grava, só mostra")
    args = parser.parse_args()
    with app.app_context():
        aplicar(dry_run=args.dry_run)
