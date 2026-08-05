# -*- coding: utf-8 -*-
"""Motor de classificação, reincidência e retrabalho — porta 1:1 do artefato original
(painel os pcm.html) pra Python. Fonte única de verdade: o front não duplica essas
regras, só consome GET /api/constants e recebe sisC/probC/reincidencia já prontos."""

import re
import unicodedata
from datetime import timedelta

FAMILIAS = {
    "COLHEDORA": "Colhedora", "TRATOR": "Trator", "CAMINHAO": "Caminhão",
    "REBOQUE": "Reboque / implemento", "LEVE": "Veículo leve / moto / ônibus",
    "IRRIG": "Irrigação", "PESADA": "Máquina pesada", "GERAL": "Geral",
}


def familia(esp):
    e = (esp or "").upper()
    if "COLHEDORA" in e:
        return "COLHEDORA"
    if "TRATOR" in e:
        return "PESADA" if "ESTEIRA" in e else "TRATOR"
    if "CAMINHAO" in e or "CAMINHÃO" in e:
        return "CAMINHAO"
    if "REBOQUE" in e or "IMPLEMENT" in e or "CARRETA" in e or "PRANCHA" in e:
        return "REBOQUE"
    if "IRRIG" in e:
        return "IRRIG"
    if "PESADA" in e or "CARREGADEIRA" in e or "ESCAVADEIRA" in e or "MOTONIVELADORA" in e or "PA CARREGADEIRA" in e:
        return "PESADA"
    if ("VEICULO" in e or "VEÍCULO" in e or "MOTOCICLETA" in e or "ONIBUS" in e
            or "ÔNIBUS" in e or "CAMIONETE" in e or "AUTOMOVEL" in e):
        return "LEVE"
    return "GERAL"


SIS_COMUNS = [
    "Motor", "Sistema Hidráulico", "Sistema Elétrico", "Freios", "Transmissão / Câmbio",
    "Suspensão / Direção", "Pneus / Rodagem", "Arrefecimento", "Cabine / Ar Condicionado",
    "Estrutura / Solda", "Lavagem / Preventiva / Pit Stop", "Acidente / Sinistro",
    "Reforma", "Outros / Não Classificado",
]
SIS_EXTRA = {
    "COLHEDORA": ["Corte de Base", "Picador / Extração", "Elevador / Alimentação", "Rodante / Esteira", "Despontador"],
    "TRATOR": ["Rodante / Esteira", "Tomada de força / Engate"],
    "CAMINHAO": ["Sistema de ar", "Basculamento / Caçamba", "Quinta roda / Engate", "Tacógrafo / Telemetria"],
    "REBOQUE": ["Basculamento / Caçamba", "Tanque / Bomba", "Engate / Cambão", "Sistema de ar", "Assoalho / Estrutura"],
    "IRRIG": ["Bomba / Motobomba", "Redutor / Carretel", "Mangueira / Emenda", "Painel / Gerador"],
    "PESADA": ["Rodante / Esteira", "Lança / Implemento"],
    "LEVE": ["Lataria / Vidros"],
}
_vistos = []
for _arr in SIS_EXTRA.values():
    for _x in _arr:
        if _x not in _vistos:
            _vistos.append(_x)
for _x in SIS_COMUNS:
    if _x not in _vistos:
        _vistos.append(_x)
SIS_LISTA = _vistos

PROB_LISTA = {
    "Sistema Hidráulico": ["Vazamento de óleo hidráulico", "Vazamento de mangueira", "Vazamento em cilindro / pistão", "Bomba / comando / transmissão", "Outros"],
    "Corte de Base": ["Canela solta / caída", "Sincronismo de facão", "Troca / quebra de facão", "Outros"],
    "Picador / Extração": ["Motor de rolo (transp./levant./1º/2º)", "Divisor de linha / ponteira / unha", "Facas / estrutura do picador", "Extrator primário / secundário", "Outros"],
    "Elevador / Alimentação": ["Esteira do elevador", "Pistão / pino de giro do elevador", "Outros"],
    "Despontador": ["Braço / corte de pontas", "Outros"],
    "Motor": ["Vazamento de óleo do motor", "Vazamento diesel / tanque / arla", "Perda de força", "Filtros / troca de óleo", "Turbina / escapamento", "Bico injetor / bomba injetora", "Ruído / batida no motor", "Outros"],
    "Sistema Elétrico": ["Sem partida", "Bateria / alternador", "Sensor / chicote / painel", "Iluminação / faróis", "Ar / telemetria", "Outros"],
    "Freios": ["Lona / pastilha / disco", "Vazamento de fluido / cuíca", "Freio de estacionamento", "Outros"],
    "Sistema de ar": ["Vazamento de ar", "Compressor / secador", "Outros"],
    "Transmissão / Câmbio": ["Marcha / embreagem", "Caixa / grupo / redutor", "Cardan / cruzeta", "Diferencial / cubo", "Outros"],
    "Suspensão / Direção": ["Mola / feixe / amortecedor", "Direção / terminal / caixa", "Pino / bucha / eixo", "Outros"],
    "Pneus / Rodagem": ["Pneu furado / calibragem", "Roda / parafuso / cubo", "Troca de pneu", "Outros"],
    "Rodante / Esteira": ["Esteira / material rodante", "Roletes / sapatas", "Outros"],
    "Arrefecimento": ["Vazamento de aditivo", "Superaquecimento / radiador", "Ventoinha / correia", "Outros"],
    "Cabine / Ar Condicionado": ["Ar condicionado", "Vidro / porta / espelho", "Banco / cinto / acabamento", "Outros"],
    "Lataria / Vidros": ["Lataria / pintura", "Vidro / porta / espelho", "Outros"],
    "Estrutura / Solda": ["Solda / trinca / chassi", "Parafuso / suporte quebrado", "Caldeiraria / fibra", "Outros"],
    "Basculamento / Caçamba": ["Não levanta / não basculha", "Trava / corrente / lona", "Outros"],
    "Tanque / Bomba": ["Vazamento no tanque / berço", "Bomba / válvula", "Outros"],
    "Engate / Cambão": ["Cambeço / cabeçalho", "Pino / olhal / engate", "Outros"],
    "Quinta roda / Engate": ["Quinta roda", "Outros"],
    "Assoalho / Estrutura": ["Assoalho / caixote", "Outros"],
    "Tomada de força / Engate": ["Tomada de força", "Outros"],
    "Bomba / Motobomba": ["Bomba / rotor / selo", "Motor / acoplamento", "Outros"],
    "Redutor / Carretel": ["Redutor / peão", "Rolamento / eixo", "Outros"],
    "Mangueira / Emenda": ["Mangueira / emenda", "Outros"],
    "Painel / Gerador": ["Painel elétrico", "Gerador / motor", "Outros"],
    "Lança / Implemento": ["Lança / braço", "Outros"],
    "Tacógrafo / Telemetria": ["Tacógrafo", "Rastreador / telemetria", "Outros"],
    "Lavagem / Preventiva / Pit Stop": ["Lavagem / lubrificação", "Preventiva / revisão", "Pit stop", "Outros"],
    "Acidente / Sinistro": ["Acidente / sinistro", "Princípio de incêndio", "Outros"],
    "Reforma": ["Reforma / entressafra", "Outros"],
    "Outros / Não Classificado": ["Outros"],
}


def norm(s):
    s = (s or "").lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip()


def _t(pattern):
    rx = re.compile(pattern)
    return lambda t: rx.search(t) is not None


# regras: (família ou "*", teste, sistema, problema) — a primeira que casar vence
REGRAS = [
    ("*", _t(r"(acidente|sinistro|tombou|tombamento|colisao|capotou|bateu no|principio de incendio|incendio)"),
     "Acidente / Sinistro", lambda t: "Princípio de incêndio" if re.search(r"incendio", t) else "Acidente / sinistro"),
    ("*", _t(r"^reforma|reforma de |reforma\b|entressafra"), "Reforma", "Reforma / entressafra"),

    ("COLHEDORA", _t(r"canela"), "Corte de Base", "Canela solta / caída"),
    ("COLHEDORA", _t(r"sincronismo"), "Corte de Base", "Sincronismo de facão"),
    ("COLHEDORA", _t(r"(facao|facoes|jogo de faca|disco de corte|corte de base)"), "Corte de Base", "Troca / quebra de facão"),
    ("COLHEDORA", _t(r"(rolo|1 rolo|2 rolo|1° rolo|2° rolo)"), "Picador / Extração", "Motor de rolo (transp./levant./1º/2º)"),
    ("COLHEDORA", _t(r"(divisor de linha|ponteira|unha|divisor)"), "Picador / Extração", "Divisor de linha / ponteira / unha"),
    ("COLHEDORA", _t(r"(extrator|primario|secundario|capuz|chapeu|exaustor)"), "Picador / Extração", "Extrator primário / secundário"),
    ("COLHEDORA", _t(r"(picador|contra faca|engol|nao pica|picando mal)"), "Picador / Extração", "Facas / estrutura do picador"),
    ("COLHEDORA", _t(r"(esteira do elevador|corrente do elevador|talisca)"), "Elevador / Alimentação", "Esteira do elevador"),
    ("COLHEDORA", _t(r"(pino de giro|pistao do elevador|giro do elevador|do giro)"), "Elevador / Alimentação", "Pistão / pino de giro do elevador"),
    ("COLHEDORA", _t(r"elevador"), "Elevador / Alimentação", "Outros"),
    ("COLHEDORA", _t(r"(despontador|corte de ponta|cortador de ponta)"), "Despontador", "Braço / corte de pontas"),

    ("*", lambda t: bool(re.search(r"mangueira", t)) and not re.search(r"irriga|emenda", t), "Sistema Hidráulico", "Vazamento de mangueira"),
    ("*", _t(r"(cilindro hidraulico|pistao hidraulico|haste do cilindro|vazamento.*cilindro|cilindro.*vazando)"), "Sistema Hidráulico", "Vazamento em cilindro / pistão"),
    ("*", _t(r"(bomba hidraulica|comando hidraulico|valvula hidraulica|bloco hidraulico|motor hidraulico)"), "Sistema Hidráulico", "Bomba / comando / transmissão"),
    ("*", _t(r"(oleo hidraulico|hidraulico|hidraulica)"), "Sistema Hidráulico", "Vazamento de óleo hidráulico"),

    ("REBOQUE", lambda t: bool(re.search(r"(berco|tanque|fibra|caldeiraria)", t)) and bool(re.search(r"(vazamento|recuperar|servico|trinca|furo)", t)), "Tanque / Bomba", "Vazamento no tanque / berço"),
    ("REBOQUE", _t(r"(cabecalho|cambao|cambeco)"), "Engate / Cambão", "Cambeço / cabeçalho"),
    ("REBOQUE", _t(r"(pino do engate|olhal|engate)"), "Engate / Cambão", "Pino / olhal / engate"),
    ("REBOQUE", _t(r"(caixote|assoalho|basculan|nao levanta|nao bascula|tombamento do caixote)"), "Basculamento / Caçamba", "Não levanta / não basculha"),
    ("REBOQUE", _t(r"(corrente de travamento|corrente|lona da carga|trava)"), "Basculamento / Caçamba", "Trava / corrente / lona"),
    ("*", _t(r"(chassis|chassi|solda|soldar|trinca|caldeiraria|fibra|quebrou o suporte|suporte quebrado|estrutura)"),
     "Estrutura / Solda",
     lambda t: "Caldeiraria / fibra" if re.search(r"(caldeiraria|fibra)", t)
     else ("Parafuso / suporte quebrado" if re.search(r"(parafuso|suporte)", t) else "Solda / trinca / chassi")),

    ("IRRIG", _t(r"(redutor|peao)"), "Redutor / Carretel", "Redutor / peão"),
    ("IRRIG", _t(r"(rolamento|eixo|carretel)"), "Redutor / Carretel", "Rolamento / eixo"),
    ("IRRIG", _t(r"(mangueira|emenda|engate rapido)"), "Mangueira / Emenda", "Mangueira / emenda"),
    ("IRRIG", _t(r"(bomba|rotor|selo mecanico|motobomba)"), "Bomba / Motobomba", "Bomba / rotor / selo"),
    ("IRRIG", _t(r"(painel|gerador|quadro eletrico|cabo)"), "Painel / Gerador", "Painel elétrico"),

    ("*", _t(r"(lona de freio|pastilha|disco de freio|tambor|sapata de freio|freio dianteiro|freio traseiro|regular freio)"), "Freios", "Lona / pastilha / disco"),
    ("*", _t(r"(cuica|vazamento de fluido|fluido de freio|freio vazando)"), "Freios", "Vazamento de fluido / cuíca"),
    ("*", _t(r"(freio de mao|freio de estacionamento)"), "Freios", "Freio de estacionamento"),
    ("*", _t(r"(vazamento de ar|perdendo ar|sem ar|valvula de ar|pulmao)"), "Sistema de ar", "Vazamento de ar"),
    ("*", _t(r"(compressor de ar|secador de ar)"), "Sistema de ar", "Compressor / secador"),
    ("*", _t(r"freio"), "Freios", "Outros"),

    ("*", _t(r"(embreagem|marcha|encavalando|cai em neutro|caindo em neutro|alavanca de marcha|nao anda|nao engata|kit de transmissao|transmissao)"), "Transmissão / Câmbio", "Marcha / embreagem"),
    ("*", _t(r"(caixa de grupo|caixa de cambio|cambio|redutor|caixa de 4 furos|caixa de transmissao)"), "Transmissão / Câmbio", "Caixa / grupo / redutor"),
    ("*", _t(r"(cardan|cruzeta|luva da cruzeta)"), "Transmissão / Câmbio", "Cardan / cruzeta"),
    ("*", _t(r"(diferencial|cubo da roda|cubo|semi eixo|semieixo)"), "Transmissão / Câmbio", "Diferencial / cubo"),
    ("*", _t(r"(pneu|calibragem|borracharia|rodagem)"), "Pneus / Rodagem",
     lambda t: "Pneu furado / calibragem" if re.search(r"(furado|vazio|murcho|calibr)", t)
     else ("Roda / parafuso / cubo" if re.search(r"(parafuso|roda|cubo)", t) else "Troca de pneu")),
    # \b no aro: sem ele "farol" casava aqui e virava problema de rodagem
    ("*", _t(r"(parafuso da roda|roda solta|\baro\b)"), "Pneus / Rodagem", "Roda / parafuso / cubo"),
    ("COLHEDORA", _t(r"(esteira|material rodante|rolete|sapata|roda motriz|tensionador)"), "Rodante / Esteira", "Esteira / material rodante"),
    ("PESADA", _t(r"(esteira|material rodante|rolete|sapata)"), "Rodante / Esteira", "Esteira / material rodante"),
    ("*", _t(r"(mola|feixe de mola|amortecedor|suspensao)"), "Suspensão / Direção", "Mola / feixe / amortecedor"),
    ("*", _t(r"(direcao|terminal de direcao|caixa de direcao|barra de direcao|volante)"), "Suspensão / Direção", "Direção / terminal / caixa"),
    ("*", _t(r"(pino|bucha|eixo dianteiro|eixo traseiro|3 eixo|terceiro eixo)"), "Suspensão / Direção", "Pino / bucha / eixo"),

    ("*", _t(r"(vazamento.*(diesel|tanque de combustivel|arla)|arla)"), "Motor", "Vazamento diesel / tanque / arla"),
    ("*", _t(r"(vazamento de oleo do motor|vazamento de ole motor|oleo no motor|vazando oleo do motor|retirar vazamento de oleo)"), "Motor", "Vazamento de óleo do motor"),
    ("*", _t(r"(perda de forca|falta de forca|sem forca|perdendo forca|morrendo|falhando|falha no cilindro)"), "Motor", "Perda de força"),
    ("*", _t(r"(filtro|troca de oleo|analise de oleo|remonta de oleo|completar oleo|nivel de oleo|luz do oleo)"), "Motor", "Filtros / troca de óleo"),
    ("*", _t(r"(turbina|escapamento|escape|catalisador)"), "Motor", "Turbina / escapamento"),
    ("*", _t(r"(bico injetor|bomba injetora|injecao|bomba de combustivel|combustivel)"), "Motor", "Bico injetor / bomba injetora"),
    ("*", _t(r"(batendo|barulho no motor|ruido no motor|fumaca)"), "Motor", "Ruído / batida no motor"),
    ("*", _t(r"(aditivo|agua do radiador)"), "Arrefecimento", "Vazamento de aditivo"),
    ("*", _t(r"(radiador|esquentando|superaquec|temperatura alta|arrefecimento)"), "Arrefecimento", "Superaquecimento / radiador"),
    ("*", _t(r"(ventoinha|correia)"), "Arrefecimento", "Ventoinha / correia"),
    ("*", _t(r"(motor de partida|nao pega na partida|sem partida|nao da partida|nao liga|partida)"), "Sistema Elétrico", "Sem partida"),
    ("*", _t(r"(bateria|alternador)"), "Sistema Elétrico", "Bateria / alternador"),
    ("*", _t(r"(sensor|chicote|fusivel|painel|monitor|modulo|eletric)"), "Sistema Elétrico", "Sensor / chicote / painel"),
    ("*", _t(r"(farol|lanterna|luz|lampada|seta|giroflex)"), "Sistema Elétrico", "Iluminação / faróis"),
    ("*", _t(r"(tacografo|rastreador|telemetria|gps|camera)"), "Tacógrafo / Telemetria",
     lambda t: "Tacógrafo" if re.search(r"tacografo", t) else "Rastreador / telemetria"),
    ("*", _t(r"(ar condicionado|climatizador|evaporador|compressor do ar)"), "Cabine / Ar Condicionado", "Ar condicionado"),
    ("*", _t(r"(vidro|espelho|retrovisor|porta da cabine|para brisa|parabrisa)"), "Cabine / Ar Condicionado", "Vidro / porta / espelho"),
    ("*", _t(r"(banco|cinto|estofado|acabamento interno|calafetar)"), "Cabine / Ar Condicionado", "Banco / cinto / acabamento"),
    ("LEVE", _t(r"(lataria|pintura|amassad|funilaria)"), "Lataria / Vidros", "Lataria / pintura"),
    ("*", _t(r"(tomada de forca|tdp)"), "Tomada de força / Engate", "Tomada de força"),
    ("PESADA", _t(r"(lanca|braco|concha|caçamba|cacamba)"), "Lança / Implemento", "Lança / braço"),

    ("*", _t(r"(nao esta recolhendo|nao quer recolher|nao recolhe|nao ergue a sapata|nao quer baixar a sapata|sapata|nao levanta a lanca)"), "Sistema Hidráulico", "Vazamento de óleo hidráulico"),
    ("*", _t(r"(nao quer erguer|nao quer levantar|levantando os dois caixotes|nao ergue o caixote|nao levanta o caixote|caixote)"), "Basculamento / Caçamba", "Não levanta / não basculha"),
    ("*", _t(r"(quinta roda|5.?roda|quinta-roda)"), "Quinta roda / Engate", "Quinta roda"),
    ("*", _t(r"(desalinhad|alinhamento|alinhar|abrir bitola|bitola|tirante)"), "Suspensão / Direção", "Pino / bucha / eixo"),
    ("*", _t(r"(mangote|adutora|aspersor|canhao|nao esta puxando|nao puxa)"), "Mangueira / Emenda", "Mangueira / emenda"),
    ("*", _t(r"(sem aceleracao|cortando aceleracao|nao acelera|acelerador|codigo stop|desligando os movimentos|nao desenvolve)"), "Motor", "Perda de força"),
    ("*", _t(r"(aquecendo|aqueceu|aquecimento|completar liquido|liquido de arref)"), "Arrefecimento", "Superaquecimento / radiador"),
    ("*", _t(r"(sem iluminacao|iluminacao)"), "Sistema Elétrico", "Iluminação / faróis"),
    ("*", _t(r"(balanca|balança)"), "Estrutura / Solda", "Parafuso / suporte quebrado"),
    ("*", _t(r"(colocar lona|lona da carreta|encerado)"), "Basculamento / Caçamba", "Trava / corrente / lona"),
    ("*", _t(r"(entrada de ar|entrando ar)"), "Motor", "Bico injetor / bomba injetora"),
    ("*", _t(r"(neutro|nao engrena|engrenando)"), "Transmissão / Câmbio", "Marcha / embreagem"),
    ("*", _t(r"(guia|peao do guia|agulha do guia)"), "Redutor / Carretel", "Rolamento / eixo"),
    ("*", _t(r"(acoplamento|conexao|conectar|desconect)"), "Engate / Cambão", "Pino / olhal / engate"),
    ("*", _t(r"(oleo)"), "Motor", "Filtros / troca de óleo"),

    ("*", _t(r"(lavagem|lubrific|graxa|engraxar)"), "Lavagem / Preventiva / Pit Stop", "Lavagem / lubrificação"),
    ("*", _t(r"(preventiva|revisao|manutencao geral|manutencao periodica|inspecao)"), "Lavagem / Preventiva / Pit Stop", "Preventiva / revisão"),
    ("*", _t(r"pit stop"), "Lavagem / Preventiva / Pit Stop", "Pit stop"),
    ("*", _t(r"(motor|avaliar motor|manutencao motor|trocar motor)"), "Motor", "Outros"),
    ("*", _t(r"(vazamento|vazando)"), "Sistema Hidráulico", "Vazamento de óleo hidráulico"),
    ("*", _t(r"(bomba|rolamento|eixo)"), "Transmissão / Câmbio", "Outros"),
    ("*", _t(r"(quebrou|quebrado|trocar|substituir|arrumar|recuperar|verificar|manutencao)"), "Estrutura / Solda", "Outros"),
]

SEM_CLASSIFICACAO = "Outros / Não Classificado"
# manutenção programada: repetir faz parte do plano, não é falha que voltou.
# Fica fora da reincidência e do retrabalho.
SISTEMAS_ROTINA = {"Lavagem / Preventiva / Pit Stop"}


def classificar_base(txt, esp):
    t = norm(txt)
    if not t:
        return (SEM_CLASSIFICACAO, "Outros")
    fam = familia(esp)
    for f, teste, sis, prob in REGRAS:
        if f != "*" and f != fam:
            continue
        if teste(t):
            return (sis, prob(t) if callable(prob) else prob)
    return (SEM_CLASSIFICACAO, "Outros")


def classificar(txt, esp, regras_customizadas=None):
    """regras_customizadas: lista de dicts {termo, fam, s, p} — criadas pelo usuário
    na tela de Classificação. Testadas antes das regras fixas."""
    t = norm(txt)
    for r in (regras_customizadas or []):
        termo = r.get("termo")
        if not termo:
            continue
        fam = r.get("fam") or "*"
        if fam != "*" and fam != familia(esp):
            continue
        if termo in t:
            return (r["s"], r["p"])
    return classificar_base(txt, esp)


# a oficina lança vários problemas numa descrição só, separados por / ou ;
# ("VAZAMENTO DE ADITIVO / TURBINA TRAVADA / TROCAR MANGUEIRA DO FREIO MOTOR").
# Classificar o texto inteiro fazia a primeira regra que casasse engolir o resto —
# no exemplo acima a O.S. virava só "vazamento de mangueira" e as outras duas
# falhas sumiam da reincidência.
_SEPARADOR = re.compile(r"[;/]")
_SO_PONTUACAO = re.compile(r"^[\s\-.,:·•ºª°()\d]*$")


def _remendar(anterior, proximo):
    """A quebra por '/' parte no meio de 'L/D', 'S/N', 'P/' e de datas — nesses casos
    o lado esquerdo acaba numa letra solta ou os dois lados são números."""
    if not anterior or not proximo:
        return True
    tokens = anterior.split()
    ultimo = tokens[-1] if tokens else ""
    if len(ultimo) == 1 or len(proximo) <= 2:
        return True
    return ultimo[-1].isdigit() and proximo[0].isdigit()


def separar_itens(txt):
    """Quebra a descrição da O.S. nos problemas que ela junta. Devolve os trechos
    na ordem em que foram lançados; se nada sobrar, devolve o texto original."""
    if not (txt or "").strip():
        return []
    partes = []
    for bruto in _SEPARADOR.split(txt):
        pedaco = bruto.strip()
        if partes and _remendar(partes[-1], pedaco):
            partes[-1] = (partes[-1] + "/" + pedaco).strip("/ ")
        else:
            partes.append(pedaco)
    itens = [p for p in partes if len(p) >= 3 and not _SO_PONTUACAO.match(p)]
    return itens or [txt.strip()]


def classificar_itens(txt, esp, regras_customizadas=None):
    """Uma classificação por problema citado na descrição: lista de
    {x: trecho, s: sistema, p: problema}, na ordem lançada e sem repetir o mesmo par."""
    itens = [
        {"x": trecho, "s": s, "p": p}
        for trecho in separar_itens(txt)
        for s, p in [classificar(trecho, esp, regras_customizadas)]
    ]
    if not itens:
        return [{"x": "", "s": SEM_CLASSIFICACAO, "p": "Outros"}]
    vistos, unicos = set(), []
    for i in itens:
        chave = (i["s"], i["p"])
        if chave not in vistos:
            vistos.add(chave)
            unicos.append(i)
    return unicos


def classificar_principal(txt, esp, regras_customizadas=None):
    """O par (sistema, problema) que representa a O.S.: o primeiro problema lançado
    que a gente consegue classificar — não o primeiro que casar com alguma regra."""
    itens = classificar_itens(txt, esp, regras_customizadas)
    i = next((x for x in itens if x["s"] != SEM_CLASSIFICACAO), itens[0])
    return (i["s"], i["p"])


CLASSES = {
    "MATERIAL": {"lbl": "Falta de material", "cls": "mat"},
    "MAO_OBRA": {"lbl": "Falta de mão de obra", "cls": "mao"},
    "DIAGNOSTICO": {"lbl": "Em diagnóstico", "cls": "diag"},
    "EXECUCAO": {"lbl": "Em execução", "cls": "exec"},
    "EXTERNO": {"lbl": "Serviço externo", "cls": "ext"},
    "NAO": {"lbl": "Classificar pendência", "cls": "none"},
}
ACOES = [
    "Levantar a peça / abrir requisição", "Cotar com fornecedor", "Aguardando aprovação da compra",
    "Emitir pedido de compra", "Aguardando faturamento do fornecedor", "Aguardando transporte / entrega",
    "Retirar no fornecedor", "Separar no almoxarifado", "Peça em usinagem / recuperação",
    "Sem estoque — buscar alternativa", "Peça recebida — aguardando montagem",
]
GRUPO_LBL = {
    "frente": "Frente / atividade", "tp": "Tipo da O.S.", "esp": "Especialidade", "mod": "Modelo",
    "agr": "Agrupamento", "ofic": "Oficina", "classe": "Pendência", "resp": "Responsável",
}


def pares(evento):
    """Pares (sistema, problema) de um evento, para comparar reincidência. Aceita a
    lista `itens` e cai no par único s/p pra histórico ainda não reclassificado.

    Serviço de rotina fica de fora: lavagem, lubrificação e preventiva acontecem
    em intervalo fixo, então repetir é o esperado — contá-las como reincidência
    enchia o painel de "85ª ocorrência" que ninguém tem o que cobrar.

    Trecho não classificado só conta quando é o único: senão ele casaria com
    qualquer outra O.S. não classificada da frota e inventaria reincidência."""
    itens = evento.get("itens")
    if not itens:
        par = (evento.get("s"), evento.get("p"))
        return set() if par[0] in SISTEMAS_ROTINA else {par}
    todos = {(i["s"], i["p"]) if isinstance(i, dict) else tuple(i) for i in itens}
    falhas = {par for par in todos if par[0] not in SISTEMAS_ROTINA}
    classificados = {par for par in falhas if par[0] != SEM_CLASSIFICACAO}
    return classificados or falhas


def calcular_reincidencia(evento, eventos_por_frota, janela_dias):
    """evento e itens de eventos_por_frota são dicts com: os, veic, d (datetime), t (horas),
    x (texto), s (sistema), p (problema) e, quando houver, itens (lista de pares).
    Reincide quando a frota repete *qualquer* um dos problemas da O.S. dentro da janela."""
    ab = evento["d"]
    lim = timedelta(days=janela_dias)
    meus = pares(evento)
    ant, casados = [], []
    for h in eventos_por_frota.get(evento["veic"], []):
        if h["os"] == evento["os"] or not (timedelta(0) < (ab - h["d"]) <= lim):
            continue
        comuns = meus & pares(h)
        if not comuns:
            continue
        ant.append(h)
        for c in comuns:
            if c not in casados:
                casados.append(c)
    if not ant:
        return None
    ant.sort(key=lambda h: h["d"], reverse=True)
    volta_em = max(0, round((ab - ant[0]["d"]).total_seconds() / 86400))
    horas = round(sum(h.get("t") or 0 for h in ant))
    return {
        "ant": ant, "n": len(ant) + 1, "voltaEm": volta_em, "horas": horas,
        "pares": [{"s": s, "p": p} for s, p in casados],
    }


def clusters_nao_classificados(historico, abertas, fam_filtro=None, busca=None, limite=120):
    """historico: dicts {texto, veic, horas_parada, sistema, esp}; abertas: dicts
    {prob, veic, sisC, esp}. Agrupa textos parecidos (mesmo prefixo normalizado) que
    caíram em 'Outros / Não Classificado', pra revisão manual na tela de Classificação."""
    grupos = {}

    def add(txt, frota, hrs, esp):
        chave = norm(txt)[:70]
        if not chave:
            return
        g = grupos.setdefault(chave, {"txt": txt, "n": 0, "h": 0.0, "frotas": set(), "fam": familia(esp)})
        g["n"] += 1
        g["h"] += hrs or 0
        g["frotas"].add(frota)

    for h in historico:
        if h["sistema"] == SEM_CLASSIFICACAO:
            add(h["texto"], h["veic"], h.get("horas_parada"), h.get("esp", ""))
    for o in abertas:
        if o["sisC"] == SEM_CLASSIFICACAO:
            add(o["prob"], o["veic"], 0, o.get("esp", ""))

    itens = [
        {"chave": k, "txt": v["txt"], "n": v["n"], "h": v["h"], "frotas": sorted(v["frotas"]), "fam": v["fam"]}
        for k, v in grupos.items()
    ]
    if fam_filtro:
        itens = [c for c in itens if c["fam"] == fam_filtro]
    if busca:
        b = norm(busca)
        itens = [c for c in itens if b in norm(c["txt"])]
    itens.sort(key=lambda c: c["n"], reverse=True)
    return itens[:limite]


def cobertura(historico, abertas):
    tot = len(historico) + len(abertas)
    nc = (sum(1 for h in historico if h["sistema"] == SEM_CLASSIFICACAO)
          + sum(1 for o in abertas if o["sisC"] == SEM_CLASSIFICACAO))
    pc = round((tot - nc) / tot * 100) if tot else 100
    return {"tot": tot, "nc": nc, "pc": pc}


def calcular_retrabalho(historico, janela_dias):
    """historico: lista de dicts {veic, d, t, s, p, itens} — só O.S. encerradas."""
    lim = timedelta(days=janela_dias)
    por_frota = {}
    for h in historico:
        por_frota.setdefault(h["veic"], []).append(h)

    rt = {}
    for v, arr in por_frota.items():
        arr = sorted(arr, key=lambda h: h["d"])
        re_count, horas, horas_re = 0, 0.0, 0.0
        for i, h in enumerate(arr):
            horas += h.get("t") or 0
            meus = pares(h)
            anterior = any(
                (meus & pares(x)) and (h["d"] - x["d"]) <= lim
                for x in arr[:i]
            )
            if anterior:
                re_count += 1
                horas_re += h.get("t") or 0
        ini, fim = (arr[0]["d"], arr[-1]["d"]) if arr else (None, None)
        rt[v] = {
            "n": len(arr), "re": re_count,
            "pc": round(re_count / len(arr) * 100) if arr else 0,
            "h": round(horas), "hRe": round(horas_re),
            "de": ini.date().isoformat() if ini else "",
            "ate": fim.date().isoformat() if fim else "",
        }
    return rt
