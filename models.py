from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

ORIGEM_BANCO = "banco"
ORIGEM_MANUAL = "manual"
ORIGEM_PLANILHA = "planilha"


def _iso(dt):
    return dt.isoformat() if dt else None


def _d(dt):
    return dt.isoformat() if dt else None


class OsAberta(db.Model):
    """O.S. abertas — sobrescrita a cada sincronização com o banco da empresa
    (ou importação manual de planilha). O.S. cadastradas manualmente ficam com
    origem='manual' e não são apagadas pelo sync."""

    __tablename__ = "os_aberta"

    os = db.Column(db.String(20), primary_key=True)
    veic = db.Column(db.String(20), nullable=False, index=True)
    desc = db.Column(db.String(255), default="")
    esp = db.Column(db.String(255), default="")
    mod = db.Column(db.String(255), default="")
    marca = db.Column(db.String(100), default="")
    agr = db.Column(db.String(255), default="")
    ano = db.Column(db.String(10), default="")
    ofic = db.Column(db.String(255), default="")
    mt = db.Column(db.String(20), default="")
    tp = db.Column(db.String(30), default="")
    ab = db.Column(db.DateTime, nullable=False)
    prob = db.Column(db.Text, default="")
    sol = db.Column(db.String(255), default="")
    prog = db.Column(db.String(20), default="")
    origem = db.Column(db.String(20), default=ORIGEM_BANCO)
    atualizado_em = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "os": self.os, "veic": self.veic, "desc": self.desc, "esp": self.esp, "mod": self.mod,
            "marca": self.marca, "agr": self.agr, "ano": self.ano, "ofic": self.ofic, "mt": self.mt,
            "tp": self.tp, "ab": _iso(self.ab), "prob": self.prob, "sol": self.sol, "prog": self.prog,
            "origem": self.origem,
        }


class OsHistorico(db.Model):
    """Cache incremental de O.S. encerradas — usado só pra calcular reincidência e
    retrabalho. Alimentado pelo sync com o banco (janela recente) e/ou importação
    manual de histórico. Upsert por `os`, nunca duplica."""

    __tablename__ = "os_historico"

    os = db.Column(db.String(20), primary_key=True)
    veic = db.Column(db.String(20), nullable=False, index=True)
    data_abertura = db.Column(db.DateTime, nullable=False)
    data_liberacao = db.Column(db.DateTime)
    horas_parada = db.Column(db.Float, default=0)
    texto = db.Column(db.String(500), default="")
    tipo_manutencao = db.Column(db.String(20), default="")
    # classificação pré-computada na sincronização (evita reclassificar dezenas de
    # milhares de linhas via regex a cada GET /api/os) — recalculada só quando uma
    # regra customizada nova é criada.
    sistema = db.Column(db.String(120), default="")
    problema = db.Column(db.String(120), default="")

    def to_dict(self):
        return {
            "os": self.os, "veic": self.veic, "d": _iso(self.data_abertura),
            "lib": _iso(self.data_liberacao), "t": self.horas_parada or 0,
            "x": self.texto, "m": self.tipo_manutencao,
            "s": self.sistema, "p": self.problema,
        }


class Frota(db.Model):
    """Cache da frota (dimensão de equipamento) — alimentada pelo sync
    (vw_bi_fluxo_dFrota) e usada na tela de Alocação e na classificação por família."""

    __tablename__ = "frota"

    codigo = db.Column(db.String(20), primary_key=True)
    modelo = db.Column(db.String(255), default="")
    especialidade = db.Column(db.String(255), default="")
    agrupamento = db.Column(db.String(255), default="")
    ativo = db.Column(db.Boolean, default=True)

    def to_dict(self):
        return {
            "c": self.codigo, "m": self.modelo, "e": self.especialidade,
            "a": self.agrupamento, "ativo": self.ativo,
        }


class OsDetalhe(db.Model):
    """Dados que o PCM lança por cima da O.S. (classificação, responsável, material,
    mão de obra, previsão de liberação). Independente de OsAberta: sobrevive a
    reimportações/sync mesmo que a O.S. suma da lista de abertas."""

    __tablename__ = "os_detalhe"

    os = db.Column(db.String(20), primary_key=True)
    classe = db.Column(db.String(20), default="NAO")
    resp = db.Column(db.String(120), default="")
    detalhe = db.Column(db.Text, default="")
    prev_lib = db.Column(db.DateTime)
    cobrado = db.Column(db.DateTime)
    sis_ov = db.Column(db.String(120), default="")
    prob_ov = db.Column(db.String(120), default="")

    item_peca = db.Column(db.String(255), default="")
    item_sol = db.Column(db.String(60), default="")
    item_sol_data = db.Column(db.Date)
    item_ped = db.Column(db.String(60), default="")
    item_ped_data = db.Column(db.Date)
    item_acao = db.Column(db.String(255), default="")
    item_acao_resp = db.Column(db.String(120), default="")
    item_previsao = db.Column(db.Date)
    item_fornec = db.Column(db.String(120), default="")

    mo_mecanico = db.Column(db.String(120), default="")
    mo_causa = db.Column(db.String(255), default="")

    aberta = db.Column(db.Boolean, default=True)
    encerrada = db.Column(db.DateTime)
    criado_em = db.Column(db.DateTime, default=datetime.utcnow)

    retornos = db.relationship(
        "OsRetorno", backref="detalhe", cascade="all, delete-orphan",
        order_by="OsRetorno.em",
    )

    def to_dict(self):
        return {
            "os": self.os,
            "classe": self.classe or "NAO",
            "resp": self.resp or "",
            "detalhe": self.detalhe or "",
            "prevLib": _iso(self.prev_lib),
            "cobrado": _iso(self.cobrado),
            "sisOv": self.sis_ov or "",
            "probOv": self.prob_ov or "",
            "item": {
                "peca": self.item_peca or "", "sol": self.item_sol or "",
                "solData": _d(self.item_sol_data), "ped": self.item_ped or "",
                "pedData": _d(self.item_ped_data), "acao": self.item_acao or "",
                "acaoResp": self.item_acao_resp or "", "previsao": _d(self.item_previsao),
                "fornec": self.item_fornec or "",
            },
            "mo": {"mecanico": self.mo_mecanico or "", "causa": self.mo_causa or ""},
            "retornos": [r.to_dict() for r in self.retornos],
            "aberta": True if self.aberta is None else self.aberta,
            "encerrada": _iso(self.encerrada),
        }


class OsRetorno(db.Model):
    __tablename__ = "os_retorno"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    os = db.Column(db.String(20), db.ForeignKey("os_detalhe.os"), nullable=False, index=True)
    em = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    txt = db.Column(db.Text, nullable=False)
    autor = db.Column(db.String(120), default="PCM")

    def to_dict(self):
        return {"em": _iso(self.em), "txt": self.txt, "autor": self.autor or ""}


class FrotaAlocacao(db.Model):
    __tablename__ = "frota_alocacao"

    codigo = db.Column(db.String(20), primary_key=True)
    atividade = db.Column(db.String(255), default="")
    frente = db.Column(db.String(60), default="")
    responsavel = db.Column(db.String(120), default="")
    local = db.Column(db.String(60), default="")

    def to_dict(self):
        return {
            "c": self.codigo, "ativ": self.atividade or "", "fr": self.frente or "",
            "resp": self.responsavel or "", "loc": self.local or "",
        }


class Contato(db.Model):
    __tablename__ = "contato"

    nome = db.Column(db.String(120), primary_key=True)
    tel = db.Column(db.String(120), default="")
    funcao = db.Column(db.String(120), default="")
    email = db.Column(db.String(120), default="")
    fixo = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            "nome": self.nome, "tel": self.tel or "", "funcao": self.funcao or "",
            "email": self.email or "", "fixo": bool(self.fixo),
        }


class RegraClassificacao(db.Model):
    __tablename__ = "regra_classificacao"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    termo = db.Column(db.String(255), nullable=False)
    familia = db.Column(db.String(20), default="*")
    sistema = db.Column(db.String(120), nullable=False)
    problema = db.Column(db.String(120), nullable=False)

    def to_dict(self):
        return {"id": self.id, "termo": self.termo, "fam": self.familia or "*", "s": self.sistema, "p": self.problema}


class Meta(db.Model):
    """Config escalar chave/valor: sla, groupBy, tvSeg, reincDias, checkpoint do
    sync incremental de histórico, flag de logo customizada."""

    __tablename__ = "meta"

    chave = db.Column(db.String(60), primary_key=True)
    valor = db.Column(db.Text)
