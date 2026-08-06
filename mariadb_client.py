"""Cliente somente leitura para o MySQL/MariaDB da empresa (mesmo banco já usado pelo
bot do WhatsApp e pelo Controle PCM — ver memória projeto-controle-pcm/db_empresa.py).
Nunca escreve nesse banco — só SELECT."""

import os

import pymysql


def _empresas():
    raw = os.environ.get("PCM_EMPRESAS", "8")
    return [int(x) for x in raw.split(",") if x.strip()]


def _conn():
    return pymysql.connect(
        host=os.environ["MARIADB_HOST"],
        port=int(os.environ.get("MARIADB_PORT", 3306)),
        user=os.environ["MARIADB_USER"],
        password=os.environ["MARIADB_PASS"],
        database=os.environ.get("MARIADB_DB", "syscustoWeb"),
        connect_timeout=20,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def _in_clause(values):
    return ",".join(["%s"] * len(values))


def _norm_tp(desc):
    """A coluna descricao_tipo_os vem suja (\"INTERNA\"/\"OS INTERNA\"/\"CAMPO\"/
    \"OS NO CAMPO\"/\"EXTERNA\"/\"OS EXTERNA\"/None...) — normaliza pro rótulo canônico
    usado no painel."""
    t = (desc or "").upper()
    if "CAMPO" in t:
        return "O.S. NO CAMPO"
    if "EXTERNA" in t:
        return "O.S. EXTERNA"
    if "INTERNA" in t:
        return "O.S. INTERNA"
    return "O.S. INTERNA"


def _prob(row):
    prob = (row.get("descricao_problema") or "").strip()
    serv = (row.get("descricao_servico") or "").strip()
    if serv and serv not in prob:
        prob = (prob + " / " + serv).strip(" /")
    return prob[:500]


def _situacao_atual_por_frota(cur, empresas, frotas):
    """codigo_situacao_veiculo de uma O.S. é gravado quando ELA é criada/atualizada e
    não é recalculado enquanto ela segue aberta — achado em produção: a O.S. 546972
    (frota 62205) segue com o campo em 'P' (Parada) desde 29/06, mas a frota já rodou
    (e voltou a rodar) várias vezes depois disso sem que essa O.S. específica fosse
    tocada de novo (57 das 222 frotas com O.S. aberta tinham esse descompasso quando
    verificado). A situação real do veículo é a da O.S. mais recente dele, aberta ou
    fechada — não a da própria O.S. aberta que se está filtrando."""
    if not frotas:
        return {}
    cur.execute(
        f"""
        SELECT codigo_frota, MAX(data_hora_abertura) AS max_ab
        FROM vw_ordem_servico_frota
        WHERE id_empresa IN ({_in_clause(empresas)}) AND codigo_frota IN ({_in_clause(frotas)})
        GROUP BY codigo_frota
        """,
        empresas + frotas,
    )
    pares = [(r["codigo_frota"], r["max_ab"]) for r in cur.fetchall() if r["max_ab"]]
    if not pares:
        return {}
    tuple_ph = ",".join(["(%s,%s)"] * len(pares))
    flat = [v for p in pares for v in p]
    cur.execute(
        f"""
        SELECT codigo_frota, codigo_situacao_veiculo
        FROM vw_ordem_servico_frota
        WHERE id_empresa IN ({_in_clause(empresas)}) AND (codigo_frota, data_hora_abertura) IN ({tuple_ph})
        """,
        empresas + flat,
    )
    return {str(r["codigo_frota"]): r["codigo_situacao_veiculo"] for r in cur.fetchall()}


def fetch_os_abertas():
    """O.S. em aberto (Aberta = A, Em Execução = E) — filtra por codigo_status (código
    curto e estável) em vez do texto de descricao_status. Achado em produção: o texto
    real é "Em Execução", não "Execução"/"Execucao" como o filtro do Controle PCM
    (db_empresa.py, de onde este veio) assumia — isso excluía silenciosamente toda
    O.S. em execução do sync (ex.: frota 62515, O.S. 553935).

    Só entra O.S. de frota parada — mas "parada" é a situação ATUAL da frota
    (ver _situacao_atual_por_frota), não o campo da própria O.S. aberta, que pode
    estar desatualizado."""
    empresas = _empresas()
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT documento, codigo_frota, descricao_frota, descricao_marca_frota,
                       descricao_especialidade_frota, descricao_especialidadeAgrup,
                       descricao_modelo_frota, descricao_oficina, descricao_tipo_manutencao,
                       descricao_tipo_os, data_hora_abertura, descricao_problema,
                       descricao_servico, descricao_solicitante, data_programacao
                FROM vw_ordem_servico_frota
                WHERE id_empresa IN ({_in_clause(empresas)})
                  AND codigo_status IN ('A', 'E')
                """,
                empresas,
            )
            rows = cur.fetchall()

            frotas = sorted({r["codigo_frota"] for r in rows if r.get("codigo_frota") is not None})
            situacao = _situacao_atual_por_frota(cur, empresas, frotas)
            rows = [r for r in rows if situacao.get(str(r.get("codigo_frota") or "")) == "P"]
    finally:
        conn.close()

    out = []
    for r in rows:
        if not r.get("documento") or not r.get("data_hora_abertura"):
            continue
        out.append({
            "os": str(r["documento"]),
            "veic": str(r.get("codigo_frota") or "").strip(),
            "desc": (r.get("descricao_frota") or "").strip(),
            "marca": (r.get("descricao_marca_frota") or "").strip(),
            "esp": (r.get("descricao_especialidade_frota") or "").strip(),
            "agr": (r.get("descricao_especialidadeAgrup") or "").strip(),
            "mod": (r.get("descricao_modelo_frota") or "").strip(),
            "ofic": (r.get("descricao_oficina") or "").strip(),
            "mt": (r.get("descricao_tipo_manutencao") or "").strip().upper() or "CORRETIVA",
            "tp": _norm_tp(r.get("descricao_tipo_os")),
            "ab": r["data_hora_abertura"],
            "prob": _prob(r),
            "sol": (r.get("descricao_solicitante") or "").strip(),
            "prog": r["data_programacao"].isoformat() if r.get("data_programacao") else "",
        })
    return out


def fetch_frota():
    """Frota própria (proprio='sim') — mesmo filtro do Controle PCM. Não filtra por
    'ativo' de propósito, pra bater com o comportamento já validado em produção lá."""
    empresas = _empresas()
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT CodFrota, descricao_modelo, descricao_especialidade,
                       descricao_especialidadeAgrup, ativo
                FROM vw_bi_fluxo_dFrota
                WHERE id_empresa IN ({_in_clause(empresas)})
                  AND LOWER(proprio) = 'sim'
                """,
                empresas,
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    vistos = set()
    out = []
    for r in rows:
        cod = str(r.get("CodFrota") or "").strip()
        if not cod or cod in vistos:
            continue
        vistos.add(cod)
        out.append({
            "codigo": cod,
            "modelo": (r.get("descricao_modelo") or "").strip(),
            "especialidade": (r.get("descricao_especialidade") or "").strip(),
            "agrupamento": (r.get("descricao_especialidadeAgrup") or "").strip(),
            "ativo": (r.get("ativo") or "").strip().upper() == "SIM",
        })
    return out


def fetch_os_historico(desde):
    """O.S. encerradas com data_hora_liberacao > desde (sync incremental). Sem
    filtro de status: qualquer O.S. já liberada entra no histórico, independente
    de status atual (a view não reabre O.S. liberada)."""
    empresas = _empresas()
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT documento, codigo_frota, data_hora_abertura, data_hora_liberacao,
                       descricao_tipo_manutencao, descricao_problema, descricao_servico
                FROM vw_ordem_servico_frota
                WHERE id_empresa IN ({_in_clause(empresas)})
                  AND data_hora_liberacao IS NOT NULL
                  AND data_hora_liberacao > %s
                ORDER BY data_hora_liberacao
                """,
                empresas + [desde],
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    out = []
    for r in rows:
        if not r.get("documento") or not r.get("data_hora_abertura"):
            continue
        ab, lib = r["data_hora_abertura"], r["data_hora_liberacao"]
        horas = max(0.0, round((lib - ab).total_seconds() / 3600, 2)) if lib and ab else 0.0
        out.append({
            "os": str(r["documento"]),
            "veic": str(r.get("codigo_frota") or "").strip(),
            "data_abertura": ab,
            "data_liberacao": lib,
            "horas_parada": horas,
            "texto": _prob(r)[:500],
            "tipo_manutencao": (r.get("descricao_tipo_manutencao") or "").strip().upper(),
        })
    return out
