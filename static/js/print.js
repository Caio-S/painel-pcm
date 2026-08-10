/* ============ util de impressão ============ */
function logoAtual() { return document.getElementById("logoImg").src }
function fmtPt(s) {
  if (!s) return "-";
  const d = new Date(s);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function durHMS(ms) {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), sgd = Math.floor(ms % 60000 / 1000);
  return h + ":" + String(m).padStart(2, "0") + ":" + String(sgd).padStart(2, "0");
}
function retrabalhoPorFrota() {
  const RT = {};
  OS_LIST.forEach(o => { if (o.retrabalho) RT[o.veic] = o.retrabalho });
  return RT;
}

/* ============ gráficos SVG (impressão — sem lib externa) ============ */
const CORES_GRAFICO = ["#1E4270", "#C6392F", "#B87A0B", "#1F7A5C", "#5B3E9B", "#C9A227", "#8A97A6"];
const _semDados = () => '<div class="psemdados">sem dados suficientes</div>';

// velocímetro: semicírculo de 0% (esquerda) a 100% (direita), agulha e valor no centro.
function svgGauge(pct) {
  if (pct == null) return _semDados();
  const p = Math.max(0, Math.min(100, pct));
  const cor = p >= 70 ? "#C6392F" : p >= 40 ? "#B87A0B" : "#1F7A5C";
  const L = 190, r = 78, cx = L / 2, cy = 96;
  const pt = ang => { const rad = (ang - 180) * Math.PI / 180; return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) } };
  const p0 = pt(0), p1 = pt(180), pv = pt(p / 100 * 180);
  const large = p / 100 * 180 > 180 ? 1 : 0;
  return `<svg viewBox="0 0 ${L} 112" style="width:100%;max-width:${L}px">
    <path d="M${p0.x},${p0.y} A${r},${r} 0 1 1 ${p1.x},${p1.y}" fill="none" stroke="#E3E9EF" stroke-width="16" stroke-linecap="round"/>
    <path d="M${p0.x},${p0.y} A${r},${r} 0 ${large} 1 ${pv.x},${pv.y}" fill="none" stroke="${cor}" stroke-width="16" stroke-linecap="round"/>
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-family="var(--mono)" font-size="24" font-weight="700" fill="${cor}">${Math.round(p)}%</text>
    <text x="${cx}" y="${cy + 11}" text-anchor="middle" font-size="7.5" letter-spacing="1" fill="#5C6B7C">RETRABALHO</text>
  </svg>`;
}

// rosca: uma fatia por item de `fatias` ([{label, valor}]), cor cíclica pela paleta do app.
function svgPizza(fatias) {
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  if (!total) return _semDados();
  const L = 150, r = 56, cx = L / 2, cy = L / 2, circ = 2 * Math.PI * r;
  let acumulado = 0;
  const arcos = fatias.map((f, i) => {
    const len = f.valor / total * circ;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${CORES_GRAFICO[i % CORES_GRAFICO.length]}"
      stroke-width="24" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-acumulado}"
      transform="rotate(-90 ${cx} ${cy})"/>`;
    acumulado += len;
    return seg;
  }).join("");
  return `<svg viewBox="0 0 ${L} ${L}" style="width:100%;max-width:${L}px">${arcos}
    <text x="${cx}" y="${cy - 3}" text-anchor="middle" font-family="var(--mono)" font-size="17" font-weight="700" fill="#0E2038">${total}</text>
    <text x="${cx}" y="${cy + 11}" text-anchor="middle" font-size="6.6" letter-spacing="1" fill="#5C6B7C">OCORRÊNCIAS</text>
  </svg>`;
}

// colunas: um ponto por item de `pontos` ([{label, valor}]). `maxForcado` fixa a
// escala do eixo (disponibilidade sempre contra 100%, pra 82% não parecer "cheio"
// igual a um mês de 100%) — sem ele, escala pelo maior valor da própria série.
function svgBarras(pontos, maxForcado, sufixo = "", cor = "#1E4270") {
  if (!pontos.length) return _semDados();
  const L = 260, alt = 130, esq = 22, baixo = 18, w = L - esq - 6, h = alt - baixo - 8;
  const max = maxForcado || Math.max(...pontos.map(p => p.valor), 1);
  const bw = w / pontos.length;
  const barras = pontos.map((p, i) => {
    const bh = Math.max(1, p.valor / max * h);
    const x = esq + i * bw + bw * 0.18, y = 8 + h - bh;
    return `<rect x="${x}" y="${y}" width="${bw * 0.64}" height="${bh}" fill="${cor}" rx="1.5"/>
      <text x="${x + bw * 0.32}" y="${8 + h + 12}" text-anchor="middle" font-size="6" fill="#5C6B7C">${esc(p.label)}</text>
      <text x="${x + bw * 0.32}" y="${y - 3}" text-anchor="middle" font-size="6.4" font-weight="700" fill="#0E2038">${Math.round(p.valor)}${sufixo}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${L} ${alt}" style="width:100%;max-width:${L}px">
    <line x1="${esq}" y1="${8 + h}" x2="${L - 6}" y2="${8 + h}" stroke="#C9CFD8"/>${barras}
  </svg>`;
}

/* ============ lista para PDF ============ */
function imprimir() {
  const l = filtrar(), ab = l.filter(o => o.aberta), al = ab.filter(vencida);
  const g = agrupar(l, CONFIG.groupBy || "esp");
  const ftxt = [filtro.alerta ? "só vencidas" : "", filtro.semCls ? "sem classificação" : "", filtro.agr, filtro.esp, filtro.mod, filtro.frente, filtro.tp,
  filtro.classe ? CONSTS.classes[filtro.classe].lbl : "", filtro.busca ? 'busca "' + filtro.busca + '"' : ""].filter(Boolean).join(" · ");
  let h = `<div class="ph"><img src="${logoAtual()}" style="height:28px;margin-right:10px;object-fit:contain"><div><b>O.S. abertas — equipamentos parados</b>
      <span>CRV Industrial · Unidade Capinópolis/MG · PCM — Planejamento e Controle de Manutenção</span></div>
      <div class="r">Emitido ${agora().toLocaleString("pt-BR")}<br>Agrupado por ${CONSTS.grupoLbl[CONFIG.groupBy || "esp"]} · ${ftxt || "todas"}</div></div>
    <div class="psum">
      <div>O.S. na lista<b>${l.length}</b></div><div>Sem retorno +${CONFIG.sla}h<b>${al.length}</b></div>
      <div>Aguardando material<b>${ab.filter(o => o.classe === "MATERIAL").length}</b></div>
      <div>Sem classificação<b>${ab.filter(o => o.classe === "NAO").length}</b></div>
      <div>Sem responsável<b>${ab.filter(o => !o.resp).length}</b></div>
      <div>Horas paradas<b>${Math.round(ab.reduce((s, o) => s + horas(agora() - new Date(o.ab)), 0)).toLocaleString("pt-BR")}</b></div></div>`;
  const cab = `<tr><th>Frota</th><th>O.S.</th><th>Aberta em</th><th>Parado</th><th>S/ retorno</th><th>Responsável</th>
    <th>Pendência</th><th>Reincid.</th><th>Problema / detalhe</th><th>Solicitação</th><th>Pedido</th><th>Ação que falta</th><th>Último retorno</th></tr>`;
  const cols = `<colgroup><col style="width:4.5%"><col style="width:5.5%"><col style="width:6.5%"><col style="width:4.5%"><col style="width:5%">
    <col style="width:8%"><col style="width:7%"><col style="width:5%"><col style="width:13%"><col style="width:7.5%"><col style="width:7.5%"><col style="width:11%"><col style="width:15%"></colgroup>`;
  const linha = o => {
    const ur = o.retornos.length ? o.retornos.slice().sort((a, b) => new Date(b.em) - new Date(a.em))[0] : null;
    const lt = o.aberta && vencida(o);
    return `<tr class="${lt ? 'late' : ''}"><td class="num">${o.veic}</td><td class="num">${o.os}</td><td class="num">${fmt(o.ab)}</td>
      <td class="num">${dur(agora() - new Date(o.ab))}</td><td class="num ${lt ? 'late' : ''}">${o.aberta ? dur(semRet(o)) : "—"}</td>
      <td>${esc(o.resp) || "—"}</td><td>${CONSTS.classes[o.classe].lbl}</td>
      <td class="num">${o.reinc ? o.reinc.n + "ª · " + o.reinc.voltaEm + "d" : "—"}</td>
      <td>${esc((o.prob || "").slice(0, 150))}${o.detalhe ? "<br><i>" + esc(o.detalhe) + "</i>" : ""}</td>
      <td class="num">${esc(o.item.sol) || "—"}${o.item.solData ? "<br>" + fmt(o.item.solData) : ""}</td>
      <td class="num">${esc(o.item.ped) || "—"}${o.item.pedData ? "<br>" + fmt(o.item.pedData) : ""}</td>
      <td>${esc(o.item.acao) || "—"}${o.item.previsao ? "<br>prev. " + fmtd(o.item.previsao) : ""}</td>
      <td>${ur ? fmt(ur.em) + " — " + esc(ur.txt.slice(0, 110)) : "sem retorno registrado"}</td></tr>`;
  };
  Object.keys(g).sort().forEach(k => {
    const arr = g[k];
    h += `<h3 class="pg">${esc(k)} — ${arr.length} O.S. · ${arr.filter(vencida).length} vencida(s) · ${Math.round(arr.reduce((s, o) => s + horas(agora() - new Date(o.ab)), 0)).toLocaleString("pt-BR")}h paradas</h3>`;
    const porMod = {}; arr.forEach(o => { (porMod[o.mod || "MODELO NÃO INFORMADO"] = porMod[o.mod || "MODELO NÃO INFORMADO"] || []).push(o) });
    Object.keys(porMod).sort().forEach(m => {
      h += `<h4 class="pm">${esc(m)} — ${porMod[m].length} O.S.</h4><table class="pt">${cols}${cab}`;
      porMod[m].sort((a, b) => semRet(b) - semRet(a)).forEach(o => h += linha(o));
      h += `</table>`;
    });
  });
  const RT = retrabalhoPorFrota();
  const rk = Object.keys(RT).filter(v => RT[v].n >= 3).sort((a, b) => RT[b].re - RT[a].re).slice(0, 25);
  if (rk.length) {
    const fMod = {}; OS_LIST.forEach(o => { fMod[o.veic] = o.mod });
    h += `<h3 class="pg">Índice de retrabalho por frota — histórico de O.S. corretivas (janela de ${CONFIG.reincDias} dias)</h3>
    <table class="pt"><colgroup><col style="width:8%"><col style="width:20%"><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:12%"></colgroup>
    <tr><th>Frota</th><th>Modelo</th><th>O.S. corretivas</th><th>Repetições</th><th>% retrabalho</th><th>Horas paradas</th><th>Horas em repetição</th><th>Período</th></tr>
    ${rk.map(v => { const r = RT[v]; return `<tr class="${r.pc >= 70 ? 'late' : ''}"><td class="num">${v}</td><td>${esc(fMod[v] || "")}</td>
      <td class="num">${r.n}</td><td class="num">${r.re}</td><td class="num ${r.pc >= 70 ? 'late' : ''}">${r.pc}%</td>
      <td class="num">${r.h} h</td><td class="num">${r.hRe} h</td><td class="num">${fmtd(r.de)} a ${fmtd(r.ate)}</td></tr>` }).join("")}
    </table>`;
  }
  h += `<div class="pfoot">Linhas em vermelho: O.S. sem retorno há mais de ${CONFIG.sla} horas. "Parado" conta desde a abertura da O.S.; "sem retorno" conta desde o último apontamento do PCM.</div>`;
  document.getElementById("print").innerHTML = h;
  window.print();
}

/* ============ relatório de reincidência de uma frota ============ */
// dataIso: string ISO (data ou data+hora); de/ate: "YYYY-MM-DD" dos inputs de
// período (em branco = sem limite naquele lado) — comparação por string funciona
// porque os dois já vêm no formato ISO (ordena igual a comparar datas de verdade).
function dentroPeriodo(dataIso, de, ate) {
  if (!dataIso) return false;
  const d = dataIso.slice(0, 10);
  if (de && d < de) return false;
  if (ate && d > ate) return false;
  return true;
}
// horas do mês `anoMes` que realmente caem dentro do período efetivo [de, fimEfetivo]
// — não o mês cheio. Achado comparando com o CHB (frota 60528, 07/04 a 30/04, um
// período de 24 dias, não o mês de abril inteiro): usar sempre 30×24=720h como
// denominador para abril dava 93% de disponibilidade; o CHB, calculando sobre os
// 24 dias pedidos (576h), deu 90,79%. A soma de horas paradas já batia (52,73h
// aqui contra 53,08h do CHB) — o erro era só o denominador maior que o período
// de verdade. Interseção do mês com [de, fimEfetivo] resolve os três casos: mês
// cheio dentro do período (comportamento de antes, sem período definido), mês
// cortado no início (de cai dentro do mês) e mês cortado no fim (fimEfetivo cai
// dentro do mês — inclui o caso da O.S. ainda aberta, já tratado em fimEfetivo).
function horasDoMesNoPeriodo(anoMes, de, fimEfetivo) {
  const [ano, mes] = anoMes.split("-").map(Number);
  const inicioMes = new Date(ano, mes - 1, 1);
  const fimMes = new Date(ano, mes, 1);
  const inicioEfetivo = de ? new Date(Math.max(inicioMes, new Date(de + "T00:00:00"))) : inicioMes;
  const fimDoMes = fimEfetivo < fimMes ? fimEfetivo : fimMes;
  return Math.max(0, (fimDoMes - inicioEfetivo) / 3600000);
}
function badgeClasse(c) {
  if (!c) return "";
  const info = CONSTS.classes[c.classe] || CONSTS.classes.NAO;
  return `<span class="pbadge ${info.cls}">${esc(info.lbl)}</span>`;
}
function chipsImpressao(itensC, paresFortes) {
  if (!itensC || !itensC.length) return "";
  const fortes = new Set((paresFortes || []).map(p => p.s + "|" + p.p));
  return `<div class="pchips">${itensC.map(i =>
    `<span class="pchip${fortes.has(i.s + "|" + i.p) ? " re" : ""}">${esc(i.s)} · ${esc(i.p)}</span>`
  ).join("")}</div>`;
}

/* imprime a ficha aberta: a O.S. de agora, o que ela repete e o histórico ao
   redor — é o documento que acompanha a cobrança ao responsável. Termina numa
   página de painel executivo (velocímetro de retrabalho, pizza dos sistemas
   mais recorrentes, colunas de horas paradas por mês) pra quem só olha o resumo. */
function imprimirFichaFrota() {
  const d = fichaAberta;
  if (!d) { aviso("Abra o histórico de uma frota antes de imprimir."); return }
  const f = d.frota || {}, aloc = d.aloc || {}, rt = d.retrabalho;
  const abertas = d.abertas || [];

  // período do relatório: em branco nos dois campos = período todo (o histórico
  // carregado inteiro), que é o padrão. Só estreita o que entra nas tabelas de
  // reincidência e no painel executivo — o card da O.S. aberta agora é sempre
  // mostrado, porque "agora" não é uma data do passado pra caber num período.
  const de = v("fhDe"), ate = v("fhAte");
  const temPeriodo = !!(de || ate);
  const hist = (d.historico || []).filter(x => dentroPeriodo(x.d, de, ate));
  const liga = hist.filter(h => h.reAberta), repet = hist.filter(h => !h.reAberta && h.re);
  // reincidência é só uma das seções do relatório — disponibilidade, nº de O.S.,
  // MTBF/MTTR vêm do histórico inteiro e fazem sentido mesmo pra frota sem nenhuma
  // reincidência (ex.: frota 60100, 46 O.S. no histórico, zero repetição). Só
  // bloqueia se não houver histórico NENHUM pra montar o relatório.
  if (!hist.length && !abertas.length) {
    aviso(temPeriodo ? "Nenhum histórico dessa frota no período escolhido." : "Esta frota não tem histórico nem O.S. aberta para gerar relatório.");
    return;
  }

  // mesma regra do back-end: o export do ERP repete a categoria nas duas colunas
  const ativ = (aloc.ativ || "").trim(), fr = (aloc.fr || "").trim();
  const frente = (fr && ativ.toUpperCase().startsWith(fr.toUpperCase())
    ? ativ : `${ativ} ${fr}`.trim()) || "sem frente definida";
  const periodoTxt = temPeriodo
    ? (de && ate ? `${fmtd(de)} a ${fmtd(ate)}` : de ? `desde ${fmtd(de)}` : `até ${fmtd(ate)}`)
    : "período todo";
  let h = `<div class="ph"><img src="${logoAtual()}" style="height:28px;margin-right:10px;object-fit:contain">
      <div><b>Reincidência — frota ${esc(d.codigo)}</b>
      <span>CRV Industrial · Unidade Capinópolis/MG · PCM — Planejamento e Controle de Manutenção</span></div>
      <div class="r">Emitido ${agora().toLocaleString("pt-BR")}<br>${esc(f.m || "")} · ${esc(f.e || "")}<br>Período: ${periodoTxt}</div></div>
    <div class="psum">
      <div>Frente / atividade<b style="font-size:9pt">${esc(frente)}</b></div>
      <div>Responsável<b style="font-size:9pt">${esc(aloc.resp || "não definido")}</b></div>
      <div>O.S. no período<b>${hist.length}</b></div>
      <div>Retrabalho (histórico completo)<b>${rt ? rt.pc + "%" : "—"}</b></div>
      <div>Horas paradas (histórico completo)<b>${rt ? Math.round(rt.h).toLocaleString("pt-BR") : 0}</b></div></div>`;

  // card de destaque: é o que justifica o papel — a O.S. que está parada agora.
  abertas.forEach(o => {
    const c = OS_LIST.find(x => x.os === o.os);
    h += `<div class="pcard">
      <div class="pfrota">${esc(d.codigo)}<small>${esc(f.m || f.e || "")}</small></div>
      <div class="pmid">
        <span class="plabel">O.S. ${esc(o.os)} — ABERTA AGORA</span>${badgeClasse(c)}
        <div class="pprob">${esc(o.prob || "—")}${c && c.detalhe ? "<br><i>" + esc(c.detalhe) + "</i>" : ""}</div>
        ${c ? chipsImpressao(c.itensC, c.reinc ? c.reinc.pares : []) : ""}
      </div>
      <div class="ptempo">${dur(agora() - new Date(o.ab))}<small>parada desde ${fmtPt(o.ab)}</small></div>
    </div>`;
  });

  const cols = `<colgroup><col style="width:6%"><col style="width:9%"><col style="width:16%">
    <col style="width:35%"><col style="width:22%"><col style="width:12%"></colgroup>`;
  const cab = `<tr><th>O.S.</th><th>Tipo</th><th>Sistema / problema</th><th>Descrição do problema</th>
    <th>Período (parada → liberação)</th><th>Duração</th></tr>`;
  const cabSis = cab.replace("<th>Sistema / problema</th>", "<th>Problema</th>");
  const linha = (x, destacar, sis) => {
    const pares = x.reAberta || x.re || [{ s: x.s, p: x.p }];
    // dentro do bloco de um sistema a coluna mostra só o problema: o sistema já
    // está no título e repeti-lo em toda linha come a largura da descrição.
    const par = sis
      ? pares.filter(p => p.s === sis).map(p => esc(p.p)).join("<br>")
      : pares.map(p => esc(p.s) + " · " + esc(p.p)).join("<br>");
    const tipo = (x.m || "CORRETIVA").toLowerCase();
    return `<tr class="${destacar ? "match" : ""}">
      <td class="num">${esc(x.os)}</td>
      <td><span class="ptp ${esc(tipo)}">${esc(x.m || "corretiva")}</span></td>
      <td class="sisp">${par}</td>
      <td>${esc(x.x || "")}</td>
      <td class="num">${fmtPt(x.d)} →<br>${x.lib ? fmtPt(x.lib) : "em aberto"}</td>
      <td class="num">${hm(x.t)}<br>(${dias(x.t)}d)</td></tr>`;
  };
  /* uma O.S. entra no bloco de cada sistema que ela repetiu — a descrição junta
     vários problemas, e a pergunta "quanto esta frota voltou por direção" só fecha
     se a parada dela contar naquele sistema também. */
  const blocosPorSistema = (arr, destacar) => {
    const g = {};
    arr.forEach(x => (x.reAberta || x.re || [{ s: x.s, p: x.p }])
      .forEach(p => (g[p.s] = g[p.s] || []).push(x)));
    // sistema que mais repetiu primeiro: é por onde a conversa com a oficina começa
    return Object.keys(g).sort((a, b) => g[b].length - g[a].length || a.localeCompare(b))
      .map(sis => {
        const itens = g[sis].sort((a, b) => new Date(b.d) - new Date(a.d));
        const hs = itens.reduce((s, x) => s + (x.t || 0), 0);
        return `<h4 class="pm">${esc(sis)} — ${itens.length} O.S. · ${hm(hs)} paradas</h4>
          <table class="pt">${cols}${cabSis}${itens.map(x => linha(x, destacar, sis)).join("")}</table>`;
      }).join("");
  };
  if (liga.length) {
    h += `<h3 class="pg alerta">${liga.length} O.S. com o mesmo problema da O.S. aberta agora</h3>
      ${blocosPorSistema(liga, true)}`;
  }
  if (repet.length) {
    h += `<h3 class="pg">${repet.length === 1 ? "Outra O.S. que repetiu" : "Outras " + repet.length + " O.S. que repetiram"}
      problema em ${CONFIG.reincDias} dias</h3>${blocosPorSistema(repet, false)}`;
  }
  if (!liga.length && !repet.length) {
    // sem nenhuma reincidência não sobrava tabela de O.S. nenhuma — só a nota e
    // direto pro painel executivo, o que parecia "relatório em branco" (usuário
    // reportou). Lista o histórico do período inteiro aqui, mais recente primeiro,
    // pra sempre ter alguma listagem de O.S. na página mesmo sem repetição.
    h += `<div class="pnota">Nenhuma reincidência detectada nesta frota${temPeriodo ? " no período escolhido" : ""} —
      mesma frota repetindo o mesmo par sistema/problema dentro de ${CONFIG.reincDias} dias. Segue o histórico completo
      do período; o painel executivo (disponibilidade, MTBF/MTTR) vem ao final.</div>`;
    if (hist.length) {
      const histOrdenado = hist.slice().sort((a, b) => new Date(b.d) - new Date(a.d));
      h += `<h3 class="pg">${hist.length} O.S. no período</h3>
        <table class="pt">${cols}${cab}${histOrdenado.map(x => linha(x, false)).join("")}</table>`;
    }
  }
  h += `<div class="pfoot">Reincidência: mesma frota repetindo o mesmo par sistema/problema dentro de ${CONFIG.reincDias} dias.
    Preventiva, preditiva e reforma não entram — entram na oficina por plano, não por falha.</div>`;

  // painel executivo — última página, resumo visual de tudo acima.
  const todos = [...liga, ...repet];
  const porSistema = {};
  todos.forEach(x => { porSistema[x.s] = (porSistema[x.s] || 0) + 1 });
  const fatiasPizza = Object.entries(porSistema).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([s, n]) => ({ label: s, valor: n }));
  const porMesRepet = {};
  todos.forEach(x => { const m = (x.d || "").slice(0, 7); if (m) porMesRepet[m] = (porMesRepet[m] || 0) + (x.t || 0) });
  const barrasHoras = Object.keys(porMesRepet).sort()
    .map(m => ({ label: m.slice(5, 7) + "/" + m.slice(2, 4), valor: porMesRepet[m] }));
  const totalHorasRepet = todos.reduce((s, x) => s + (x.t || 0), 0);

  // disponibilidade e nº de O.S. por mês: todo o histórico do período (não só as
  // repetições) — a O.S. aberta agora entra no mês em que abriu, contando até o
  // fim do período escolhido (ou até agora, se o período não tem fim definido).
  // Uma segunda conta, só das corretivas, alimenta MTBF/MTTR — preventiva/
  // preditiva/reforma não são falha, então não podem contar como "quebra" nesses
  // dois indicadores (mesma exclusão que retrabalho/reincidência já fazem em
  // outras partes do relatório).
  //
  // Achado comparando com o relatório oficial do CHB (frota 60528, julho/26): com
  // "até" = 31/07 mas o relógio real em 10/08, contar a O.S. aberta até agora()
  // somava 269h de parada só dela (11 dias que na real nem são de julho) e a
  // disponibilidade do mês saía 54% contra os 84,56% do CHB. Cortando em 31/07
  // 23:59:59 a mesma conta fecha em 84,77% — a diferença que sobra é só a
  // diferença de 2 O.S. no total de corretivas do mês (17 aqui, 19 lá).
  const fimPeriodo = ate ? new Date(ate + "T23:59:59") : agora();
  const fimEfetivo = fimPeriodo < agora() ? fimPeriodo : agora();
  const inicioPeriodo = de ? new Date(de + "T00:00:00") : null;
  const statsPorMes = {}, statsCorretivaPorMes = {};
  const addMes = (mapa, mesChave, horasParada, osNum) => {
    const s = mapa[mesChave] || (mapa[mesChave] = { horas: 0, os: new Set() });
    s.horas += horasParada || 0;
    s.os.add(osNum);
  };
  // terceiro achado, mesmo método (comparando com o CHB, frota 60907: maio
  // isolado deu 75,86% lá, 70% aqui, mesmo já corrigido o resto): uma O.S. que
  // atravessa a VIRADA DO MÊS (não só a borda do período, ex.: abriu em maio e
  // só fechou em junho) jogava a duração inteira no mês em que abriu — igual o
  // CHB faria se alguém rodasse o relatório dele só pra abril–maio parcial, o
  // pedaço de junho ficaria de fora e maio ficaria "pesado" demais. distribuirPorMes
  // fatia o intervalo [início, fim] já cortado pelo período em pedaços por mês
  // corrente, e cada mês só leva a fatia que realmente é dele.
  const distribuirPorMes = (mapa, inicio, fim, osNum) => {
    let cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
    while (cursor < fim) {
      const proximoMes = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const inicioSeg = cursor > inicio ? cursor : inicio;
      const fimSeg = proximoMes < fim ? proximoMes : fim;
      const horasSeg = (fimSeg - inicioSeg) / 3600000;
      if (horasSeg > 0) {
        addMes(mapa, cursor.getFullYear() + "-" + String(cursor.getMonth() + 1).padStart(2, "0"), horasSeg, osNum);
      }
      cursor = proximoMes;
    }
  };
  // uma O.S. de REFORMA abriu 26/02 e só fechou 10/04 — atravessa o início do
  // período. `hist` (filtrado por dentroPeriodo, que só olha a data de ABERTURA)
  // não pegava essa O.S. de jeito nenhum, perdendo as ~79h dela que caem dentro
  // do período (07/04 a 10/04). E o oposto também acontecia: O.S. que abriram
  // dentro do período mas só fecharam depois do "até" entravam com a duração
  // INTEIRA, passando do fim. As duas contam certo usando a SOBREPOSIÇÃO do
  // intervalo [abertura, liberação] da O.S. com o período, não só onde ela abriu.
  (d.historico || []).forEach(x => {
    if (!x.d) return;
    const abre = new Date(x.d), fecha = x.lib ? new Date(x.lib) : fimEfetivo;
    if (inicioPeriodo && fecha < inicioPeriodo) return;
    if (fecha < abre || abre > fimEfetivo) return;
    const inicioClip = inicioPeriodo && inicioPeriodo > abre ? inicioPeriodo : abre;
    const fimClip = fecha > fimEfetivo ? fimEfetivo : fecha;
    if (fimClip <= inicioClip) return;
    distribuirPorMes(statsPorMes, inicioClip, fimClip, x.os);
    if ((x.m || "CORRETIVA").toUpperCase() === "CORRETIVA") distribuirPorMes(statsCorretivaPorMes, inicioClip, fimClip, x.os);
  });
  abertas.forEach(o => {
    const abre = new Date(o.ab);
    if (inicioPeriodo && abre > fimEfetivo) return;
    const inicioClip = inicioPeriodo && inicioPeriodo > abre ? inicioPeriodo : abre;
    if (fimEfetivo <= inicioClip) return;
    distribuirPorMes(statsPorMes, inicioClip, fimEfetivo, o.os);
    if ((o.mt || "CORRETIVA").toUpperCase() === "CORRETIVA") distribuirPorMes(statsCorretivaPorMes, inicioClip, fimEfetivo, o.os);
  });
  const mesesOrdenados = Object.keys(statsPorMes).sort();
  const barrasDisponibilidade = mesesOrdenados.map(m => {
    const totalHorasMes = horasDoMesNoPeriodo(m, de, fimEfetivo);
    const parada = Math.min(statsPorMes[m].horas, totalHorasMes);
    return { label: m.slice(5, 7) + "/" + m.slice(2, 4), valor: Math.max(0, 100 - parada / totalHorasMes * 100) };
  });
  const barrasOsPorMes = mesesOrdenados.map(m => ({ label: m.slice(5, 7) + "/" + m.slice(2, 4), valor: statsPorMes[m].os.size }));
  // média do período: ponderada pelas horas de cada mês, não a média simples das
  // porcentagens — um mês parcial (ex.: 24 dias de abril) não pode pesar igual a
  // um mês cheio (31 dias de maio). Comparado com o CHB (frota 60907, abril
  // parcial a junho inteiro): média simples dava 68%, ponderada bate nos 64,45%
  // do CHB (64%).
  const totalHorasParadasPeriodo = mesesOrdenados.reduce((s, m) => s + Math.min(statsPorMes[m].horas, horasDoMesNoPeriodo(m, de, fimEfetivo)), 0);
  const totalHorasPeriodoTodos = mesesOrdenados.reduce((s, m) => s + horasDoMesNoPeriodo(m, de, fimEfetivo), 0);
  const dispMedia = totalHorasPeriodoTodos
    ? Math.round(100 - totalHorasParadasPeriodo / totalHorasPeriodoTodos * 100) : null;

  // MTTR = horas paradas em corretiva no mês ÷ nº de corretivas no mês (tempo médio
  // de reparo). MTBF = horas em operação no mês (o resto das horas do mês) ÷ nº de
  // corretivas (tempo médio de operação entre uma quebra e outra). Só entram meses
  // com pelo menos uma corretiva — sem isso MTBF de um mês sem quebra nenhuma
  // "puxaria" o gráfico pro alto sem significar nada (não é que rodou muito bem
  // naquele mês, é que não teve corretiva pra medir contra).
  const mesesCorretiva = Object.keys(statsCorretivaPorMes).sort();
  const barrasMTTR = mesesCorretiva.map(m => {
    const c = statsCorretivaPorMes[m];
    return { label: m.slice(5, 7) + "/" + m.slice(2, 4), valor: c.horas / c.os.size };
  });
  const barrasMTBF = mesesCorretiva.map(m => {
    const c = statsCorretivaPorMes[m], totalHorasMes = horasDoMesNoPeriodo(m, de, fimEfetivo);
    return { label: m.slice(5, 7) + "/" + m.slice(2, 4), valor: Math.max(0, (totalHorasMes - c.horas) / c.os.size) };
  });
  const media = arr => arr.length ? Math.round(arr.reduce((s, p) => s + p.valor, 0) / arr.length) : null;
  const mtbfMedio = media(barrasMTBF), mttrMedio = media(barrasMTTR);

  h += `<div class="pexec">
    <div class="pexechead"><b>Painel executivo — frota ${esc(d.codigo)}</b>
      <span>Resumo visual do período (${periodoTxt}) — reincidência na janela de ${CONFIG.reincDias} dias</span></div>
    <div class="pkpis">
      <div><b>${hist.length}</b><small>O.S. no período</small></div>
      <div><b>${todos.length}</b><small>Repetições no período</small></div>
      <div><b>${dispMedia != null ? dispMedia + "%" : "—"}</b><small>Disponibilidade média</small></div>
      <div><b>${rt ? rt.pc + "%" : "—"}</b><small>Retrabalho (histórico completo)</small></div>
      <div><b>${mtbfMedio != null ? mtbfMedio + "h" : "—"}</b><small>MTBF médio</small></div>
      <div><b>${mttrMedio != null ? mttrMedio + "h" : "—"}</b><small>MTTR médio</small></div>
    </div>
    <div class="pgrid">
      <div class="pgraf"><h5>Retrabalho da frota</h5>${svgGauge(rt ? rt.pc : null)}</div>
      <div class="pgraf"><h5>Sistemas mais recorrentes</h5>${svgPizza(fatiasPizza)}
        <div class="plegenda">${fatiasPizza.map((f, i) =>
          `<div><i style="background:${CORES_GRAFICO[i % CORES_GRAFICO.length]}"></i>${esc(f.label)} — ${f.valor}</div>`).join("")}</div></div>
      <div class="pgraf"><h5>Horas paradas por mês (repetições)</h5>${svgBarras(barrasHoras)}</div>
    </div>
    <div class="pgrid pgrid4">
      <div class="pgraf"><h5>Disponibilidade por mês</h5>${svgBarras(barrasDisponibilidade, 100, "%", "#1F7A5C")}</div>
      <div class="pgraf"><h5>Nº de O.S. por mês</h5>${svgBarras(barrasOsPorMes, null, "", "#5B3E9B")}</div>
      <div class="pgraf"><h5>MTBF por mês (corretivas)</h5>${svgBarras(barrasMTBF, null, "h", "#1E4270")}</div>
      <div class="pgraf"><h5>MTTR por mês (corretivas)</h5>${svgBarras(barrasMTTR, null, "h", "#B87A0B")}</div>
    </div>
    <div class="pfoot">Retrabalho considera todas as O.S. corretivas da frota (mínimo 3), sempre sobre o histórico completo —
      abaixo de 40% em verde, de 40% a 70% em âmbar, acima de 70% em vermelho. Disponibilidade = 100% − (horas paradas no mês
      ÷ horas do mês dentro do período escolhido — mês parcial no início/fim do período conta só os dias pedidos, não o mês
      inteiro); a O.S. ainda aberta entra com o tempo parado até o fim do período (ou até agora, sem período definido). MTBF
      (tempo médio entre falhas) = horas em operação no mês ÷ nº de corretivas; MTTR (tempo médio de reparo) = horas paradas
      em corretiva no mês ÷ nº de corretivas — os dois só contam O.S. corretiva (preventiva/preditiva/reforma não são falha)
      e só entram meses com pelo menos uma. O.S. cuja parada atravessa a virada do mês é contada inteira no mês em que abriu.
      Sistemas e horas por mês (gráfico de colunas superior) somam só as repetições listadas nas páginas anteriores; os 4
      gráficos de baixo somam todo o período escolhido.</div>
  </div>`;

  document.getElementById("print").innerHTML = h;
  window.print();
}
fhImprimir.onclick = imprimirFichaFrota;

/* ============ relatório de disponibilidade por frente ============ */
function imprimirDisponibilidade() {
  const g = frentesAlocadas();
  if (!Object.keys(g).length) { aviso("Defina a atividade e a frente das frotas em Alocação de frota."); return }
  const COLS = ["ROD", "MAN", "PREV", "REF", "OPE"], MARCA = { ROD: "OK", MAN: "X", PREV: "P", REF: "R", OPE: "X" };
  const CLS = { ROD: "ok", MAN: "man", PREV: "prev", REF: "ref", OPE: "ope" };
  const fMap = {}; FROTA_LIST.forEach(f => fMap[f.c] = f);
  const cols = `<colgroup><col style="width:4.2%"><col style="width:7.5%"><col style="width:4%">
    <col style="width:2.8%"><col style="width:2.8%"><col style="width:2.8%"><col style="width:2.8%"><col style="width:2.8%">
    <col style="width:7.5%"><col style="width:5%"><col style="width:4.2%"><col style="width:5%"><col style="width:3%">
    <col style="width:8%"><col style="width:37.6%"></colgroup>`;
  let paginas = "";
  Object.keys(g).sort().forEach(ativ => {
    let geral = { ROD: 0, MAN: 0, PREV: 0, REF: 0, OPE: 0 }, gt = 0, blocos = "";
    Object.keys(g[ativ]).sort().forEach(fr => {
      const cods = g[ativ][fr].sort(), cnt = { ROD: 0, MAN: 0, PREV: 0, REF: 0, OPE: 0 };
      let linhas = "";
      cods.forEach(c => {
        const s = statusFrota(c), o = s.o, f = fMap[c] || { m: "" }, a = (FROTA_LIST.find(x => x.c === c) || {}).aloc || {};
        cnt[s.st]++; geral[s.st]++; gt++;
        const cel = k => `<td class="st ${s.st === k ? CLS[k] : ""}">${s.st === k ? MARCA[k] : "-"}</td>`;
        linhas += `<tr><td class="fr">${c}</td><td class="md">${esc(f.m || "")}</td><td class="md">${esc(a.loc || "-")}</td>
          ${COLS.map(cel).join("")}
          <td class="n">${o ? fmtPt(o.ab) : "-"}</td><td class="n">${o ? durHMS(agora() - new Date(o.ab)) : ""}</td>
          <td class="n">${o ? o.os : "-"}</td><td class="n">${o && o.prevLib ? fmtPt(o.prevLib) : "-"}</td><td class="n">-</td>
          <td class="rs">${esc((o && o.resp) || a.resp || "")}</td>
          <td class="mo">${o ? esc(((o.detalhe ? o.detalhe + " — " : "") + (o.prob || "")).slice(0, 210)) : ""}</td></tr>`;
      });
      const t = cods.length, pc = Math.round(cnt.ROD / t * 100);
      blocos += `<div class="relfr">${esc(fr)}</div>
      <table class="rel">${cols}
        <tr class="band"><td colspan="3"></td><td colspan="5" class="bd">STATUS</td><td colspan="2"></td>
          <td colspan="3" class="bd2">LIBERAR EQUIPAMENTO</td><td colspan="2"></td></tr>
        <tr><th>Frota</th><th>Modelo</th><th>Código</th><th>Rod</th><th>Man</th><th>Prev</th><th>Ref</th><th>Ope</th>
          <th>Parada</th><th>ΔT (h)</th><th>O.S</th><th>Previsão</th><th>⏱</th><th>Responsável</th><th>Motivo</th></tr>
        ${linhas}
        <tr class="tt"><td colspan="3"></td>${COLS.map(k => `<td>${cnt[k]}</td>`).join("")}<td>${t}</td><td></td>
          <td class="dlbl" colspan="3" rowspan="2">DISPONIBILIDADE</td><td class="dval" colspan="2" rowspan="2">${pc}%</td></tr>
        <tr class="tp"><td colspan="3"></td>${COLS.map(k => `<td>${Math.round(cnt[k] / t * 100)}%</td>`).join("")}<td>100%</td><td></td></tr>
      </table>`;
    });
    const pg = Math.round(geral.ROD / (gt || 1) * 100);
    paginas += `<div class="relpg">
      <div class="relhead">
        <div class="rellogo"><img src="${logoAtual()}" style="height:24px;object-fit:contain"></div>
        <div class="reltit">Disponibilidade Frota - ${esc(ativ)}</div>
        <div class="reldt">${agora().toLocaleDateString("pt-BR")} ${agora().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
      </div>
      ${blocos}
      <div class="relger"><b>Total geral</b>
        <span class="nums">${COLS.map(k => k + " " + geral[k]).join("  ·  ")}  ·  TOTAL ${gt}</span>
        <span class="nums" style="color:#5C6B7C">${COLS.map(k => Math.round(geral[k] / (gt || 1) * 100) + "%").join("  ·  ")}</span>
        <b style="margin-left:auto;font-style:italic">Disponibilidade</b><em>${pg}%</em></div>
      <div class="pfoot">ROD = rodando (sem O.S. aberta no sistema) · MAN = corretiva · PREV = preventiva · REF = reforma · OPE = parada operacional.
        Apurado a partir das O.S. abertas ao vivo e da classificação lançada pelo PCM · emitido por PCM — Planejamento e Controle de Manutenção.</div>
    </div>`;
  });
  document.getElementById("print").innerHTML = paginas;
  window.print();
}
btnDisp.onclick = async () => { if (!FROTA_LIST.length) FROTA_LIST = await api('/frota'); imprimirDisponibilidade(); };

btnPrint.onclick = imprimir;
