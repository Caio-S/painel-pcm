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

/* ============ lista para PDF ============ */
function imprimir() {
  const l = filtrar(), ab = l.filter(o => o.aberta), al = ab.filter(vencida);
  const g = agrupar(l, CONFIG.groupBy || "esp");
  const ftxt = [filtro.alerta ? "só vencidas" : "", filtro.semCls ? "sem classificação" : "", filtro.agr, filtro.esp, filtro.mod, filtro.frente, filtro.tp,
  filtro.classe ? CONSTS.classes[filtro.classe].lbl : "", filtro.busca ? 'busca "' + filtro.busca + '"' : "", filtro.encerradas ? "encerradas" : "abertas"].filter(Boolean).join(" · ");
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
      <td class="num">${esc(o.item.sol) || "—"}${o.item.solData ? "<br>" + fmtd(o.item.solData) : ""}</td>
      <td class="num">${esc(o.item.ped) || "—"}${o.item.pedData ? "<br>" + fmtd(o.item.pedData) : ""}</td>
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

/* ============ fluxograma do processo ============ */
const FLX = {
  nos: [
    { id: "ini", x: 20, y: 120, w: 200, h: 74, t: "fim", n: "1", tit: "O.S. aberta no CHBWEB", sub: "equipamento parado no campo ou na oficina" },
    { id: "imp", x: 20, y: 250, w: 200, h: 84, t: "acao", n: "2", tit: "Atualizar o painel", sub: "clicar em Atualizar agora — traz O.S. e frota ao vivo do banco" },
    { id: "dal", x: 280, y: 112, w: 210, h: 90, t: "dec", tit: "A frota tem frente e local?" },
    { id: "aloc", x: 280, y: 250, w: 210, h: 84, t: "acao", tit: "Alocação de frota", sub: "atividade, frente, local e responsável" },
    { id: "tri", x: 550, y: 110, w: 230, h: 94, t: "acao", n: "3", tit: "Triagem em até 30 min", sub: "abrir a ficha, definir o responsável e classificar a pendência" },
    { id: "dre", x: 550, y: 250, w: 230, h: 96, t: "dec", tit: "É reincidência?", sub: "mesma frota, mesmo problema em 30 dias" },
    { id: "cob", x: 550, y: 396, w: 230, h: 96, t: "alerta", n: "4", tit: "Gerar cobrança", sub: "responsável + gerência da oficina · marcar como cobrada" },
    { id: "dpe", x: 840, y: 112, w: 220, h: 90, t: "dec", tit: "Qual é a pendência?" },
    { id: "mat", x: 840, y: 246, w: 220, h: 100, t: "acao", tit: "Falta de material", sub: "peça, nº da solicitação, nº do pedido, ação que falta e previsão" },
    { id: "mo", x: 840, y: 366, w: 220, h: 82, t: "acao", tit: "Falta de mão de obra", sub: "equipe e motivo · acionar a oficina" },
    { id: "dia", x: 840, y: 468, w: 220, h: 82, t: "acao", tit: "Diagnóstico ou execução", sub: "o que trava e previsão de liberação" },
    { id: "cic", x: 1120, y: 112, w: 220, h: 96, t: "acao", n: "5", tit: "Retorno a cada 3 horas", sub: "registrar no painel — o cronômetro zera" },
    { id: "dve", x: 1120, y: 250, w: 220, h: 90, t: "dec", tit: "Passou de 3 h sem retorno?" },
    { id: "cbr", x: 1120, y: 384, w: 220, h: 88, t: "alerta", tit: "Cobrar agora", sub: "card fica vermelho, entra na TV e no resumo do grupo" },
    { id: "dli", x: 1120, y: 512, w: 220, h: 90, t: "dec", tit: "Equipamento liberado?" },
    { id: "enc", x: 1120, y: 646, w: 220, h: 78, t: "acao", n: "6", tit: "Encerrar a O.S.", sub: "no CHBWEB — some sozinho do painel no próximo sync" },
    { id: "fim", x: 840, y: 646, w: 220, h: 78, t: "fim", tit: "Histórico atualizado", sub: "alimenta reincidência e índice de retrabalho" },
  ],
  setas: [
    ["ini", "dal", ""], ["ini", "imp", ""], ["imp", "aloc", ""],
    ["dal", "aloc", "não"], ["dal", "tri", "sim"], ["aloc", "tri", ""],
    ["tri", "dre", ""], ["dre", "cob", "sim"], ["dre", "dpe", "não"], ["cob", "dpe", ""],
    ["dpe", "mat", ""], ["dpe", "mo", ""], ["dpe", "dia", ""],
    ["mat", "cic", ""], ["mo", "cic", ""], ["dia", "cic", ""],
    ["cic", "dve", ""], ["dve", "cbr", "sim"], ["dve", "dli", "não"], ["cbr", "dli", ""],
    ["dli", "cic", "não"], ["dli", "enc", "sim"], ["enc", "fim", ""],
  ],
};
function flxQuebra(txt, larg, px) {
  const max = Math.max(8, Math.floor(larg / (px * 0.53))), out = []; let l = "";
  (txt || "").split(" ").forEach(p => { if ((l + " " + p).trim().length > max) { out.push(l.trim()); l = p } else l += " " + p });
  if (l.trim()) out.push(l.trim()); return out;
}
function flxCaixa(nd) {
  const cor = {
    acao: { f: "#16304F", b: "#16304F", t: "#fff", s: "#C6D5E6" },
    dec: { f: "#FCF3E0", b: "#C9A227", t: "#5A4708", s: "#7A6316" },
    alerta: { f: "#C6392F", b: "#C6392F", t: "#fff", s: "#F6D4D0" },
    fim: { f: "#E7F3EE", b: "#1F7A5C", t: "#0F4A38", s: "#2E6B56" },
  }[nd.t];
  let g = "";
  if (nd.t === "dec") {
    const cx = nd.x + nd.w / 2, cy = nd.y + nd.h / 2;
    g += `<polygon points="${cx},${nd.y} ${nd.x + nd.w},${cy} ${cx},${nd.y + nd.h} ${nd.x},${cy}" fill="${cor.f}" stroke="${cor.b}" stroke-width="2"/>`;
  } else {
    g += `<rect x="${nd.x}" y="${nd.y}" width="${nd.w}" height="${nd.h}" rx="${nd.t === "fim" ? nd.h / 2 : 7}" fill="${cor.f}" stroke="${cor.b}" stroke-width="2"/>`;
  }
  const tl = flxQuebra(nd.tit, nd.w - (nd.t === "dec" ? 70 : 28), 13.5);
  const sl = nd.sub ? flxQuebra(nd.sub, nd.w - (nd.t === "dec" ? 70 : 28), 11) : [];
  const alt = tl.length * 16 + (sl.length ? sl.length * 13 + 4 : 0);
  let y = nd.y + nd.h / 2 - alt / 2 + 13;
  tl.forEach(t => { g += `<text x="${nd.x + nd.w / 2}" y="${y}" text-anchor="middle" font-family="Segoe UI,Arial" font-size="13.5" font-weight="700" fill="${cor.t}">${t}</text>`; y += 16 });
  if (sl.length) { y += 2; sl.forEach(t => { g += `<text x="${nd.x + nd.w / 2}" y="${y}" text-anchor="middle" font-family="Segoe UI,Arial" font-size="11" fill="${cor.s}">${t}</text>`; y += 13 }) }
  if (nd.n) g += `<circle cx="${nd.x + 16}" cy="${nd.y + 16}" r="12" fill="#C9A227"/><text x="${nd.x + 16}" y="${nd.y + 20.5}" text-anchor="middle" font-family="Segoe UI,Arial" font-size="12.5" font-weight="800" fill="#2A2100">${nd.n}</text>`;
  return g;
}
function flxSeta(a, b, lbl) {
  const A = { l: a.x, r: a.x + a.w, t: a.y, b: a.y + a.h, cx: a.x + a.w / 2, cy: a.y + a.h / 2 },
    B = { l: b.x, r: b.x + b.w, t: b.y, b: b.y + b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
  let d = "", lx = 0, ly = 0;
  if (B.l > A.r + 6) {
    const mx = A.r + Math.max(18, (B.l - A.r) / 2);
    d = `M${A.r} ${A.cy} H${mx} V${B.cy} H${B.l - 7}`;
    lx = (A.r + mx) / 2; ly = A.cy - 7;
  } else if (B.t > A.b + 6) {
    const my = A.b + Math.max(14, (B.t - A.b) / 2);
    d = `M${A.cx} ${A.b} V${my} H${B.cx} V${B.t - 7}`;
    lx = A.cx + 9; ly = (A.b + my) / 2 + 4;
  } else if (B.b < A.t - 6) {
    const my = A.t - Math.max(14, (A.t - B.b) / 2);
    d = `M${A.cx} ${A.t} V${my} H${B.cx} V${B.b + 7}`;
    lx = A.cx + 9; ly = (A.t + my) / 2;
  } else {
    const mx = Math.min(A.l, B.l) - 32;
    d = `M${A.l} ${A.cy} H${mx} V${B.cy} H${B.l - 7}`;
    lx = mx + 14; ly = (A.cy + B.cy) / 2;
  }
  let g = `<path d="${d}" fill="none" stroke="#5C6B7C" stroke-width="1.8" marker-end="url(#fseta)"/>`;
  if (lbl) g += `<rect x="${lx - 13}" y="${ly - 11}" width="27" height="15" rx="3" fill="#fff" stroke="#D5DCE5"/><text x="${lx}" y="${ly}" text-anchor="middle" font-family="Segoe UI,Arial" font-size="10.5" font-weight="700" fill="#16304F">${lbl}</text>`;
  return g;
}
function fluxoSVG() {
  const N = {}; FLX.nos.forEach(n => N[n.id] = n);
  let g = `<svg viewBox="0 0 1380 780" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff">
    <defs><marker id="fseta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#5C6B7C"/></marker></defs>
    <text x="20" y="34" font-family="Segoe UI,Arial" font-size="19" font-weight="700" fill="#0E2038" letter-spacing="1">FLUXO DE TRATAMENTO DAS O.S. — PCM</text>
    <text x="20" y="56" font-family="Segoe UI,Arial" font-size="12" fill="#5C6B7C">CRV Industrial · Unidade Capinópolis/MG · da abertura da O.S. ao encerramento, com os prazos de cobrança</text>
    <line x1="20" y1="72" x2="1360" y2="72" stroke="#C9A227" stroke-width="2.5"/>`;
  FLX.setas.forEach(([a, b, l]) => { g += flxSeta(N[a], N[b], l) });
  FLX.nos.forEach(n => { g += flxCaixa(n) });
  g += `<rect x="20" y="700" width="1340" height="62" rx="6" fill="#F4F6F8" stroke="#D5DCE5"/>
    <text x="38" y="722" font-family="Segoe UI,Arial" font-size="12" font-weight="800" fill="#16304F" letter-spacing=".8">ROTINA DIÁRIA DO RESPONSÁVEL</text>
    <text x="38" y="741" font-family="Segoe UI,Arial" font-size="11.5" fill="#3C4B5C">Manhã: clicar em Atualizar agora · triar as O.S. sem classificação · cobrar as vencidas e as reincidências.</text>
    <text x="38" y="757" font-family="Segoe UI,Arial" font-size="11.5" fill="#3C4B5C">Fim do turno: atualizar retornos · gerar Lista para PDF e Disponibilidade · copiar o resumo para o grupo.</text>
    <text x="1342" y="750" text-anchor="end" font-family="Segoe UI,Arial" font-size="10.5" fill="#8494A5">Prazo de retorno configurado: ${CONFIG.sla} h · janela de reincidência: ${CONFIG.reincDias} dias</text>
    </svg>`;
  return g;
}
function abrirFluxo() { flxBox.innerHTML = fluxoSVG(); maskFlx.classList.add("on") }
function imprimirFluxo() {
  document.getElementById("print").innerHTML = `<div class="relpg"><div class="relhead">
    <div class="rellogo"><img src="${logoAtual()}" style="height:24px;object-fit:contain"></div>
    <div class="reltit" style="color:#0E2038">Fluxo de tratamento das O.S. — PCM</div>
    <div class="reldt">${agora().toLocaleDateString("pt-BR")}</div></div>${fluxoSVG()}</div>`;
  window.print();
}

btnPrint.onclick = imprimir;
btnFluxo.onclick = abrirFluxo;
fX.onclick = fFechar.onclick = () => maskFlx.classList.remove("on");
maskFlx.onclick = e => { if (e.target === maskFlx) maskFlx.classList.remove("on") };
fPrint.onclick = imprimirFluxo;
