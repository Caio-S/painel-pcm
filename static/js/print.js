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

btnPrint.onclick = imprimir;
