/* ================= PAINEL TV ================= */
let tvTela = 0, tvPag = 0, tvPausa = false, tvTimer = null;
function statusFrota(cod) {
  const ab = OS_LIST.filter(o => o.aberta && o.veic === cod);
  if (!ab.length) return { st: "ROD", o: null };
  const o = ab.slice().sort((a, b) => new Date(a.ab) - new Date(b.ab))[0];
  const st = o.classe === "MAO_OBRA" ? "OPE" : o.mt === "PREVENTIVA" ? "PREV" : o.mt === "REFORMA" ? "REF" : "MAN";
  return { st, o, n: ab.length };
}
function frentesAlocadas() {
  const g = {};
  FROTA_LIST.forEach(f => {
    const a = f.aloc; if (!a || (!a.ativ && !a.fr)) return;
    const ativ = a.ativ || "SEM ATIVIDADE", fr = a.fr || "SEM FRENTE";
    g[ativ] = g[ativ] || {}; (g[ativ][fr] = g[ativ][fr] || []).push(f.c);
  });
  return g;
}
function telas() { const t = ["panorama"]; if (FROTA_LIST.some(f => f.aloc.ativ || f.aloc.fr)) t.push("frentes"); t.push("criticas", "material", "reincidencia"); return t }
function tvLinhas(alturaExtra) { return Math.max(5, Math.floor((window.innerHeight - (alturaExtra || 300)) / Math.max(52, window.innerHeight * .075))) }

async function tvRender() {
  if (!FROTA_LIST.length) FROTA_LIST = await api('/frota');
  const ab = OS_LIST.filter(o => o.aberta);
  const al = ab.filter(vencida).sort((a, b) => semRet(b) - semRet(a));
  const mat = ab.filter(o => o.classe === "MATERIAL").sort((a, b) => (a.item.ped ? 1 : 0) - (b.item.ped ? 1 : 0) || semRet(b) - semRet(a));
  const hs = Math.round(ab.reduce((s, o) => s + horas(agora() - new Date(o.ab)), 0));
  const semHist = ab.filter(o => o.semHistorico).length;
  tvKpis.innerHTML = `
    <div class="tvk"><small>Equipamentos parados</small><b>${ab.length}</b><i>${[...new Set(ab.map(o => o.esp))].length} especialidades</i></div>
    <div class="tvk red"><small>Sem retorno +${CONFIG.sla}h</small><b>${al.length}</b><i>${Math.round(al.length / (ab.length || 1) * 100)}% da frota parada</i></div>
    <div class="tvk amber"><small>Aguardando material</small><b>${mat.length}</b><i>${mat.filter(o => !o.item.ped).length} sem pedido de compra</i></div>
    <div class="tvk gold"><small>Horas paradas acumuladas</small><b>${hs.toLocaleString("pt-BR")}</b><i>média ${Math.round(hs / (ab.length || 1))}h por O.S.</i></div>
    <div class="tvk red"><small>Reincidências</small><b>${ab.filter(o => o.reinc).length}</b><i>${semHist ? semHist + " O.S. sem histórico da frota" : ab.filter(o => o.reinc && !o.cobrado).length + " sem cobrança enviada"}</i></div>`;
  const T = telas(); if (tvTela >= T.length) tvTela = 0;
  const tela = T[tvTela];
  if (tela === "panorama") tvPanorama(ab);
  if (tela === "frentes") tvFrentes();
  if (tela === "criticas") tvTabela(al, "criticas");
  if (tela === "material") tvTabela(mat, "material");
  if (tela === "reincidencia") tvTabela(ab.filter(o => o.reinc).sort((a, b) => b.reinc.n - a.reinc.n), "reincidencia");
  tvDots.innerHTML = T.map((t, i) => `<i class="${i === tvTela ? 'on' : ''}"></i>`).join("");
  tvClk.textContent = agora().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  tvClkD.textContent = agora().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}
function tvPanorama(ab) {
  tvT.textContent = "Panorama da frota parada";
  tvS.textContent = "O.S. abertas por especialidade e modelo";
  const porEsp = {}; ab.forEach(o => { (porEsp[o.esp] = porEsp[o.esp] || []).push(o) });
  const esps = Object.keys(porEsp).sort((a, b) => porEsp[b].length - porEsp[a].length).slice(0, 10);
  const maior = Math.max(...esps.map(e => porEsp[e].length), 1);
  const linhasEsp = esps.map(e => {
    const arr = porEsp[e], venc = arr.filter(vencida).length;
    const mods = Object.entries(arr.reduce((a, o) => { const m = o.mod || "—"; a[m] = (a[m] || 0) + 1; return a }, {})).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([m, n]) => m + " (" + n + ")").join(" · ");
    const cnt = {}; arr.forEach(o => cnt[o.classe] = (cnt[o.classe] || 0) + 1);
    const barras = Object.keys(cnt).map(k => `<i class="${CONSTS.classes[k].cls}" style="width:${cnt[k] / arr.length * 100}%"></i>`).join("");
    return `<div class="esp" style="width:${30 + 70 * arr.length / maior}%;min-width:100%">
      <div class="n">${esc(e)}<u>${esc(mods)}</u></div>
      <div class="q">${arr.length}${venc ? `<u>${venc} vencidas</u>` : ""}</div>
      <div class="espbar">${barras}</div></div>`;
  }).join("");
  const top = ab.slice().sort((a, b) => new Date(a.ab) - new Date(b.ab)).slice(0, tvLinhas(430));
  tvBody.innerHTML = `
   <div class="tvpanel" style="flex:1.25"><h3>O.S. abertas por especialidade <em>${Object.keys(porEsp).length} especialidades</em></h3>
     <div class="tvscroll"><div class="espgrid">${linhasEsp}</div></div></div>
   <div class="tvpanel" style="flex:1"><h3>Paradas mais antigas <em>tempo total parado</em></h3>
     <div class="tvscroll">${top.map(o => `
       <div class="tvrow ${vencida(o) ? 'late' : ''}" style="grid-template-columns:auto 1fr auto">
         <div class="r-frota">${o.veic}<u>${esc(o.mod || o.esp)}</u></div>
         <div class="r-txt">${esc((o.prob || "").slice(0, 70))}<u>${esc(o.resp || "sem responsável")} · ${CONSTS.classes[o.classe].lbl}</u></div>
         <div class="r-num late">${dur(agora() - new Date(o.ab))}</div></div>`).join("")}</div></div>`;
  tvFoot.textContent = (tvPausa ? "pausado · " : "") + "atualizado " + agora().toLocaleTimeString("pt-BR");
}
function tvFrentes() {
  tvT.textContent = "Disponibilidade por frente";
  tvS.textContent = "equipamentos rodando x parados em cada frente";
  const g = frentesAlocadas(); let cards = "";
  Object.keys(g).sort().forEach(ativ => Object.keys(g[ativ]).sort().forEach(fr => {
    const cods = g[ativ][fr], t = cods.length;
    const par = cods.filter(c => statusFrota(c).st !== "ROD");
    const pc = Math.round((t - par.length) / t * 100);
    const nv = pc >= 85 ? "ok" : pc >= 70 ? "md" : "bad";
    cards += `<div class="frc"><b>${esc(ativ)} ${esc(fr)}</b>
      <div class="pc ${nv}">${pc}<span style="font-size:.45em">%</span></div>
      <div class="frbar"><i class="ok" style="width:${pc}%"></i><i class="stop" style="width:${100 - pc}%"></i></div>
      <div class="sub">${t - par.length} de ${t} rodando · ${par.length} parado(s)</div>
      <div class="lst">${par.slice(0, 8).map(c => { const s = statusFrota(c); return c + " " + (s.o ? dur(agora() - new Date(s.o.ab)) : "") }).join("<br>")}</div></div>`;
  }));
  tvBody.innerHTML = `<div class="tvpanel" style="flex:1"><h3>Frentes acompanhadas <em>base: alocação cadastrada no PCM</em></h3>
    <div class="tvscroll"><div class="frgrid">${cards}</div></div></div>`;
  tvFoot.textContent = (tvPausa ? "pausado · " : "") + "atualizado " + agora().toLocaleTimeString("pt-BR");
}
function tvTabela(arr, tipo) {
  const porPag = tvLinhas(360);
  const pgs = Math.max(1, Math.ceil(arr.length / porPag));
  if (tvPag >= pgs) tvPag = 0;
  const fatia = arr.slice(tvPag * porPag, (tvPag + 1) * porPag);
  if (tipo === "criticas") {
    tvT.textContent = "Sem retorno há mais de " + CONFIG.sla + " horas";
    tvS.textContent = "prioridade de cobrança do PCM";
    const cols = "auto 1.6fr .8fr .9fr auto auto";
    tvBody.innerHTML = `<div class="tvpanel" style="flex:1">
      <h3>${arr.length} O.S. aguardando retorno <em>página ${tvPag + 1}/${pgs}</em></h3>
      <div class="tvscroll">
        <div class="tvrow h" style="grid-template-columns:${cols}"><span>Frota</span><span>Problema / o que trava</span><span>Pendência</span><span>Responsável</span><span>Parado</span><span>S/ retorno</span></div>
        ${fatia.map(o => `<div class="tvrow late" style="grid-template-columns:${cols}">
          <div class="r-frota">${o.veic}<u>${esc(o.mod || o.esp)}</u></div>
          <div class="r-txt">${esc((o.detalhe || o.prob || "").slice(0, 90))}<u>O.S. ${o.os} · ${esc(o.esp)} · ${esc(o.ofic)}</u></div>
          <div class="r-tag ${CONSTS.classes[o.classe].cls}">${CONSTS.classes[o.classe].lbl}</div>
          <div class="r-txt">${esc(o.resp) || '<span style="color:var(--tv-red)">definir</span>'}</div>
          <div class="r-num">${dur(agora() - new Date(o.ab))}</div>
          <div class="r-num late">${dur(semRet(o))}</div></div>`).join("")}
      </div></div>`;
  } else if (tipo === "reincidencia") {
    tvT.textContent = "Reincidência — mesma frota, mesmo problema";
    tvS.textContent = "falhas que voltaram dentro de " + CONFIG.reincDias + " dias";
    const cols = "auto 1.4fr 1fr auto auto auto";
    tvBody.innerHTML = `<div class="tvpanel" style="flex:1">
      <h3>${arr.length} O.S. abertas são repetição de falha <em>página ${tvPag + 1}/${pgs}</em></h3>
      <div class="tvscroll">
        <div class="tvrow h" style="grid-template-columns:${cols}"><span>Frota</span><span>Problema</span><span>Responsável</span><span>Ocorr.</span><span>Voltou em</span><span>Parado</span></div>
        ${fatia.map(o => `<div class="tvrow late" style="grid-template-columns:${cols}">
          <div class="r-frota">${o.veic}<u>${esc(o.mod || o.esp)}</u></div>
          <div class="r-txt">${esc(o.probC)}<u>${esc(o.sisC)} · O.S. ${o.os}${o.cobrado ? " · cobrada" : ""}</u></div>
          <div class="r-txt">${esc(o.resp || o.respFr) || '<span style="color:var(--tv-red)">definir</span>'}</div>
          <div class="r-num late">${o.reinc.n}ª</div><div class="r-num late">${o.reinc.voltaEm}d</div>
          <div class="r-num">${dur(agora() - new Date(o.ab))}</div></div>`).join("")}
      </div></div>`;
    if (!arr.length) tvBody.querySelector(".tvscroll").innerHTML = `<div style="padding:4vh;color:var(--tv-dim);font-size:1.1vw">Nenhuma reincidência entre as O.S. abertas.</div>`;
  } else {
    tvT.textContent = "Fila de material — o que falta para a peça chegar";
    tvS.textContent = "O.S. paradas por falta de material";
    const cols = "auto 1.2fr .9fr .9fr 1.1fr auto";
    tvBody.innerHTML = `<div class="tvpanel" style="flex:1">
      <h3>${arr.length} O.S. aguardando material <em>página ${tvPag + 1}/${pgs}</em></h3>
      <div class="tvscroll">
        <div class="tvrow h" style="grid-template-columns:${cols}"><span>Frota</span><span>Peça</span><span>Solicitação</span><span>Pedido</span><span>Ação que falta</span><span>Parado</span></div>
        ${fatia.map(o => `<div class="tvrow ${o.item.ped ? '' : 'late'}" style="grid-template-columns:${cols}">
          <div class="r-frota">${o.veic}<u>${esc(o.mod || o.esp)}</u></div>
          <div class="r-txt">${esc(o.item.peca) || "peça não informada"}<u>O.S. ${o.os} · ${esc(o.resp || "sem responsável")}</u></div>
          <div class="r-txt">${esc(o.item.sol) || '<span style="color:var(--tv-red)">sem solicitação</span>'}<u>${o.item.solData ? fmtd(o.item.solData) : ""}</u></div>
          <div class="r-txt">${esc(o.item.ped) || '<span style="color:var(--tv-red)">sem pedido</span>'}<u>${o.item.pedData ? fmtd(o.item.pedData) : ""}</u></div>
          <div class="r-txt">${esc(o.item.acao) || '<span style="color:var(--tv-amber)">definir ação</span>'}<u>${o.item.previsao ? "previsão " + fmtd(o.item.previsao) : "sem previsão"}</u></div>
          <div class="r-num late">${dur(agora() - new Date(o.ab))}</div></div>`).join("")}
      </div></div>`;
    if (!arr.length) tvBody.querySelector(".tvscroll").innerHTML = `<div style="padding:4vh;color:var(--tv-dim);font-size:1.1vw">Nenhuma O.S. classificada como falta de material.</div>`;
  }
  tvFoot.textContent = (tvPausa ? "pausado · " : "") + "atualizado " + agora().toLocaleTimeString("pt-BR");
  window.__pgs = pgs;
}
function tvProx() {
  const T = telas(), pgs = window.__pgs || 1;
  if ((T[tvTela] === "criticas" || T[tvTela] === "material" || T[tvTela] === "reincidencia") && tvPag < pgs - 1) { tvPag++; }
  else { tvTela = (tvTela + 1) % T.length; tvPag = 0; }
  tvRender();
}
function tvCiclo() { clearInterval(tvTimer); tvTimer = setInterval(() => { if (!tvPausa) tvProx() }, (CONFIG.tvSeg || 22) * 1000) }
async function modoTV(on) {
  document.body.dataset.mode = on ? "tv" : "gestao";
  if (on) {
    tvTela = 0; tvPag = 0;
    if (!FROTA_LIST.length) FROTA_LIST = await api('/frota');
    await tvRender(); tvCiclo();
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => { });
  } else {
    clearInterval(tvTimer);
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => { });
  }
}
btnTV.onclick = () => modoTV(true);
tvExit.onclick = () => modoTV(false);
document.addEventListener("keydown", e => {
  if (document.body.dataset.mode !== "tv") return;
  if (e.key === "Escape") modoTV(false);
  if (e.code === "Space") { e.preventDefault(); tvPausa = !tvPausa; tvRender() }
  if (e.key === "ArrowRight") { tvProx(); tvCiclo() }
  if (e.key === "ArrowLeft") { const T = telas(); tvTela = (tvTela + T.length - 1) % T.length; tvPag = 0; tvRender(); tvCiclo() }
});
window.addEventListener("resize", () => { if (document.body.dataset.mode === "tv") tvRender() });
