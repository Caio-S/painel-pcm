/* ============ api ============ */
const $ = id => document.getElementById(id);
async function api(path, opts) {
  const res = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    let msg = 'Erro ' + res.status;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ============ estado ============ */
let CONSTS = { sisLista: [], probLista: {}, classes: {}, acoes: [], grupoLbl: {}, familias: {} };
let CONFIG = { sla: 3, reincDias: 30, groupBy: 'frente', tvSeg: 22 };
let OS_LIST = [];
let filtro = { alerta: false, semCls: false, reinc: false, semH: false, agr: "", esp: "", mod: "", frente: "", tp: "", classe: "", busca: "" };
let abertaId = null;
/* grupos recolhidos — guardados por chave, não por posição: o re-render reordena
   os grupos pelo número de O.S., então um índice apontaria pro grupo errado */
let recolhidos = new Set();
let expandidos = new Set();
/* última ficha de frota carregada — o relatório de reincidência imprime a partir
   dela, pra sair exatamente o que está na tela */
let fichaAberta = null;

/* ============ util ============ */
const esc = s => String(s == null ? "" : s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
const agora = () => new Date();
const horas = ms => ms / 3600000;
function dur(ms) {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000);
  return h >= 48 ? Math.floor(h / 24) + "d " + (h % 24) + "h" : h + "h" + String(m).padStart(2, "0");
}
function fmt(s) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
/* "2026-08-06" (data pura) o JS interpreta como meia-noite UTC, e em UTC-3 o
   toLocaleDateString devolve o dia ANTERIOR — a previsão de chegada saía 05/08
   no card e 06/08 no formulário. Data com hora não tem esse problema: sem offset
   ela já é lida como local. */
function dataLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
}
function fmtd(s) { return s ? dataLocal(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"; }
function li(s) {
  if (!s) return "";
  const d = new Date(s); if (isNaN(d)) return "";
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
}
function ld(s) { return s ? String(s).slice(0, 10) : ""; }
function carimbaAgora(idNumero, idData) {
  const num = document.getElementById(idNumero), data = document.getElementById(idData);
  if (!num || !data) return;
  num.addEventListener("input", () => { if (num.value.trim() && !data.value) data.value = li(new Date()) });
}
function ultRet(o) { return (o.retornos && o.retornos.length) ? new Date(o.retornos.map(r => r.em).sort().slice(-1)[0]) : new Date(o.ab); }
function semRet(o) { return agora() - ultRet(o); }
// duas previsões possíveis: liberação do equipamento (prevLib, qualquer classe —
// preenchida em Detalhar pendência) ou chegada da peça (item.previsao, só MATERIAL).
// Vale a que ainda não passou: prazo combinado só substitui o SLA enquanto está de
// pé. Depois que vence, a O.S. volta a cobrar sozinha — é justamente a promessa não
// cumprida que interessa. A de peça é data pura, então só expira no fim do dia:
// senão uma peça que chega hoje já nasceria vencida de manhã.
function previsaoEm(o) {
  const datas = [];
  if (o.prevLib) datas.push(new Date(o.prevLib));
  if (o.classe === "MATERIAL" && o.item && o.item.previsao) {
    const d = dataLocal(o.item.previsao);
    d.setHours(23, 59, 59, 999);
    datas.push(d);
  }
  const futuras = datas.filter(d => !isNaN(d) && d > agora()).sort((a, b) => a - b);
  return futuras.length ? futuras[0] : null;
}
function temPrevisao(o) { return !!previsaoEm(o) }
function previsaoLabel(o) {
  return (o.prevLib && new Date(o.prevLib) > agora()) ? fmt(o.prevLib) : fmtd(o.item.previsao);
}
function vencida(o) {
  if (!o.aberta) return false;
  // com previsão cadastrada, a tag vira "Previsão: dd/mm" em vez de "retorno
  // vencido" — cobrar retorno antes do prazo combinado não faz sentido.
  if (temPrevisao(o)) return false;
  return horas(semRet(o)) >= CONFIG.sla;
}
let tId; function aviso(m) { toast.textContent = m; toast.classList.add("on"); clearTimeout(tId); tId = setTimeout(() => toast.classList.remove("on"), 2600); }
const v = id => { const e = document.getElementById(id); return e ? e.value.trim() : "" };

/* ============ filtro / agrupamento ============ */
// filtros "estruturais" (barra de cima: agrupamento, especialidade, modelo, frente,
// tipo, pendência, busca, sem histórico) — recortam QUAL equipamento está em tela,
// e por isso os KPIs também devem respeitar esse recorte (filtrar colhedoras deve
// atualizar os números dos KPIs pra só colhedoras). Os toggles dos próprios KPIs
// (retorno vencido, sem classificação, reincidência) ficam de fora daqui: cada KPI
// calcula sua contagem em cima da base, não em cima do resultado de se clicar nele
// mesmo — senão o número exibido colapsaria pro tamanho da lista já filtrada.
function filtrarBase() {
  const q = filtro.busca.toLowerCase();
  return OS_LIST.filter(o => {
    if (filtro.semH && !o.semHistorico) return false;
    if (filtro.agr && o.agr !== filtro.agr) return false;
    if (filtro.esp && o.esp !== filtro.esp) return false;
    if (filtro.mod && o.mod !== filtro.mod) return false;
    if (filtro.frente && o.frente !== filtro.frente) return false;
    if (filtro.tp && o.tp !== filtro.tp) return false;
    if (filtro.classe && o.classe !== filtro.classe) return false;
    if (q && !((o.veic + " " + o.os + " " + o.desc + " " + o.mod + " " + o.esp + " " + o.prob + " " + (o.detalhe || "") + " " + (o.resp || "") + " " + o.frente + " " + (o.item.peca || "") + " " + (o.item.sol || "") + " " + (o.item.ped || "")).toLowerCase().includes(q))) return false;
    return true;
  });
}
function filtrar() {
  return filtrarBase().filter(o => {
    if (filtro.alerta && !vencida(o)) return false;
    if (filtro.semCls && o.classe !== "NAO") return false;
    if (filtro.reinc && !o.reinc) return false;
    return true;
  }).sort((a, b) => {
    const va = vencida(a), vb = vencida(b);
    if (va !== vb) return va ? -1 : 1;
    return semRet(b) - semRet(a);
  });
}
function agrupar(l, by) {
  if (!by) return { "TODAS AS O.S.": l };
  const g = {};
  l.forEach(o => { const k = by === "classe" ? CONSTS.classes[o.classe].lbl : (o[by] || "NÃO INFORMADO"); (g[k] = g[k] || []).push(o) });
  return g;
}
function kpis() {
  const ab = filtrarBase().filter(o => o.aberta), al = ab.filter(vencida);
  const mat = ab.filter(o => o.classe === "MATERIAL"), sem = ab.filter(o => o.classe === "NAO");
  kAlert.textContent = al.length; kAlertSub.textContent = "de " + ab.length + " O.S. sem retorno há +" + CONFIG.sla + "h";
  kAbertas.textContent = ab.length; kAbertasSub.textContent = [...new Set(ab.map(o => o.esp))].length + " especialidades";
  kMat.textContent = mat.length;
  const semPed = mat.filter(o => !o.item.ped).length;
  kMatSub.textContent = semPed ? semPed + " sem pedido registrado" : "todas com pedido";
  kSem.textContent = sem.length;
  const rr = ab.filter(o => o.reinc);
  kReinc.textContent = rr.length;
  const naoCob = rr.filter(o => !o.cobrado).length;
  const semH = ab.filter(o => o.semHistorico).length;
  kReincSub.textContent = (naoCob ? naoCob + " sem cobrança" : "todas cobradas") + (semH ? " · " + semH + " O.S. sem histórico da frota" : "");
  const th = ab.reduce((s, o) => s + horas(agora() - new Date(o.ab)), 0);
  kHoras.textContent = Math.round(th).toLocaleString("pt-BR");
  kHorasSub.textContent = "média de " + Math.round(th / (ab.length || 1)) + "h por O.S.";
  kpiAlert.classList.toggle("active", filtro.alerta);
  kpiMat.classList.toggle("active", filtro.classe === "MATERIAL");
  kpiSem.classList.toggle("active", filtro.semCls);
  kpiReinc.classList.toggle("active", filtro.reinc);
}

/* ============ cards ============ */
function blocoMat(o) {
  const it = o.item, s = it.solData, p = it.pedData;
  const gap = s ? "solicitado " + dur(new Date(s) - new Date(o.ab)) + " após a parada" : "PEÇA AINDA NÃO SOLICITADA";
  return `<div class="pend"><b>Material:</b> ${esc(it.peca) || "peça não informada"}
    <div class="kv"><span>${it.sol ? "Solic. " + esc(it.sol) : "sem solicitação"}</span><span>${s ? fmt(s) : "—"}</span>
    <span>${it.ped ? "Pedido " + esc(it.ped) : "sem pedido"}</span><span>${p ? fmt(p) : "—"}</span>
    <span>${it.previsao ? "chega " + fmtd(it.previsao) : "sem previsão"}</span>${it.fornec ? `<span>${esc(it.fornec)}</span>` : ""}</div>
    <div class="kv"><span class="${s ? '' : 'warn'}">${gap}</span></div>
    <div class="acao">▸ ${it.acao ? "Falta: " + esc(it.acao) + (it.acaoResp ? " — " + esc(it.acaoResp) : "") : "Ação pendente não definida"}</div></div>`;
}
/* a descrição da O.S. costuma juntar vários problemas; itensC traz um por problema
   e reinc.pares diz qual deles foi o que voltou */
function itens(o) { return o.itensC && o.itensC.length ? o.itensC : [{ s: o.sisC, p: o.probC }] }
function listaPares(pares, o) {
  const arr = (pares && pares.length) ? pares : [{ s: o.sisC, p: o.probC }];
  return arr.map(i => `<b>${esc(i.s)} · ${esc(i.p)}</b>`).join(" + ");
}
function programado(sis) { return (CONSTS.sisProgramados || []).includes(sis) }
function chipsProblemas(o) {
  const l = itens(o), rp = new Set(((o.reinc && o.reinc.pares) || []).map(i => i.s + "|" + i.p));
  if (l.length < 2) return "";
  return `<div class="probs">${l.map(i => {
    const re = rp.has(i.s + "|" + i.p), prog = programado(i.s);
    const t = prog ? "serviço programado — não conta reincidência nem retrabalho" : (i.x || "");
    return `<span class="prob${re ? " prob-re" : prog ? " prob-prog" : ""}" title="${esc(t)}">${esc(i.s)} · ${esc(i.p)}${re ? " ↺" : ""}</span>`;
  }).join("")}</div>`;
}

function card(o) {
  const sr = semRet(o), pct = Math.min(100, horas(sr) / CONFIG.sla * 100);
  const nv = pct >= 100 ? "late" : pct >= 70 ? "warn" : "ok";
  const c = CONSTS.classes[o.classe] || CONSTS.classes.NAO;
  const ur = o.retornos.length ? o.retornos.slice().sort((a, b) => new Date(b.em) - new Date(a.em))[0] : null;
  let pend = "";
  if (o.classe === "MATERIAL") pend = blocoMat(o);
  else if (o.classe === "MAO_OBRA") pend = `<div class="pend"><b>Mão de obra:</b> ${esc(o.mo.causa) || "causa não informada"}${o.mo.mecanico ? " — " + esc(o.mo.mecanico) : ""}</div>`;
  else if (o.detalhe) pend = `<div class="pend">${esc(o.detalhe)}</div>`;
  const rc = o.reinc;
  const semH = !rc && o.semHistorico;
  const rbox = rc ? `<div class="rbox"><b>REINCIDÊNCIA — ${rc.n}ª ocorrência em ${CONFIG.reincDias} dias.</b>
      ${listaPares(rc.pares, o)} — voltou em ${rc.voltaEm} dia(s), ${rc.horas}h paradas nas ocorrências anteriores.
      <button class="linklike" data-frota-hist="${o.veic}">Ver histórico da frota →</button>
      ${o.cobrado ? `<div class="cob">✓ Cobrança enviada em ${fmt(o.cobrado)}</div>` : ""}</div>`
    : (semH ? `<div class="pend" style="border-left:3px solid #A9B6C4;color:var(--ink2)">Sem histórico desta frota carregado — não dá para dizer se é reincidência.</div>` : "");
  const aberto = expandidos.has(o.os);
  return `<article class="os ${vencida(o) ? 'vencida' : ''} ${aberto ? 'os-open' : ''}">
   <div class="os-top">
    <button class="frota clickable" data-frota-hist="${o.veic}">${o.veic}<span>${esc(o.mod || o.esp)}</span></button>
    <div class="os-meta">
      <div class="tags">${rc ? `<span class="tag reinc flash">${rc.n}ª vez · ${rc.voltaEm}d</span>` : ""}<span class="tag tagfr">${esc(o.frente)}</span><span class="tag ${c.cls}">${c.lbl}</span>
        ${vencida(o) ? '<span class="tag diag flash">retorno vencido</span>' : temPrevisao(o) ? `<span class="tag prev">Previsão: ${previsaoLabel(o)}</span>` : ''}</div>
      <div class="veic">${esc(o.desc)} · ${esc(o.esp)} · O.S. ${o.os} · ${esc(o.ofic)}</div>
      <div class="motivo">${esc(o.prob) || "—"}</div>
      ${chipsProblemas(o)}
    </div>
   </div>
   <div class="os-clock">
      <div class="tempo">${dur(agora() - new Date(o.ab))}<small>parado desde ${fmt(o.ab)}</small></div>
      <div class="tempo ${nv}">${dur(sr)}<small>sem retorno</small></div>
      <div class="sla-bar"><div class="sla-fill ${nv}" style="width:${pct}%"></div></div>
      <button class="os-chevron" data-toggle="${o.os}" aria-expanded="${aberto}" aria-label="Mostrar mais detalhes">
        <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
      </button>
    </div>
   <div class="os-more">
    <div class="os-body">
     ${(function () { const r = o.retrabalho; if (!r || r.n < 3) return ""; const b = r.pc >= 70 ? "b1" : r.pc >= 40 ? "b2" : "b3";
      return `<button class="rt ${b} clickable" data-frota-hist="${o.veic}">Retrabalho da frota: ${r.pc}% · ${r.re} de ${r.n} O.S. · ${r.h}h paradas</button>` })()}
     ${(o.resp || o.respFr) ? `<span class="resp">Responsável: ${esc(o.resp || o.respFr)}</span>` : `<span class="resp" style="color:var(--red);background:var(--red-bg)">Sem responsável</span>`}
     ${o.prevLib ? `<span class="resp" style="background:var(--green-bg);color:var(--green)">Previsão de liberação: ${fmt(o.prevLib)}</span>` : ""}
     ${rbox}${pend}
     <div class="ultimo">${ur ? `<b>Último retorno (${fmt(ur.em)}${ur.autor ? " · " + esc(ur.autor) : ""}):</b> ${esc(ur.txt)}` : "<b>Nenhum retorno registrado.</b> A contagem corre desde a abertura."}</div>
    </div>
    <div class="os-actions">
     <button class="btn btn-dark" data-act="ret" data-os="${o.os}">Registrar retorno</button>
     <button class="btn btn-line" data-act="det" data-os="${o.os}">Detalhar pendência</button>
     ${rc ? `<button class="btn btn-red" style="background:var(--red);color:#fff" data-act="cob" data-os="${o.os}">Cobrar reincidência</button>` : ""}</div>
   </div>
  </article>`;
}

function render() {
  kpis();
  chSemH.classList.toggle("on", filtro.semH);
  const l = filtrar();
  cont.textContent = l.length + " O.S. na tela";
  const g = agrupar(l, CONFIG.groupBy);
  const chaves = Object.keys(g).sort((a, b) => g[b].length - g[a].length || a.localeCompare(b));
  grupos.innerHTML = l.length ? chaves.map(k => {
    const arr = g[k], venc = arr.filter(vencida).length;
    const hs = Math.round(arr.reduce((s, o) => s + horas(agora() - new Date(o.ab)), 0));
    const aberto = !recolhidos.has(k);
    return `<section class="grupo${aberto ? "" : " fechado"}">
      <button class="gh" data-grupo="${encodeURIComponent(k)}" aria-expanded="${aberto}"
        title="${aberto ? "Recolher" : "Abrir"} este grupo">
        <span class="gh-seta">▾</span><h2>${esc(k)}</h2>
        <em>${arr.length} O.S.${venc ? ` · <b>${venc} vencida(s)</b>` : ""} · ${hs.toLocaleString("pt-BR")}h paradas</em>
      </button>
      <div class="grid">${arr.map(card).join("")}</div></section>`;
  }).join("") : `<div class="empty">Nenhuma O.S. neste filtro.</div>`;
  grupos.querySelectorAll("[data-grupo]").forEach(b => b.onclick = () => {
    const k = decodeURIComponent(b.dataset.grupo);
    if (recolhidos.has(k)) recolhidos.delete(k); else recolhidos.add(k);
    render();
  });
  grupos.querySelectorAll("[data-act]").forEach(b => b.onclick = () => b.dataset.act === "ret" ? retornoRapido(b.dataset.os) : b.dataset.act === "cob" ? cobrar(b.dataset.os) : abrir(b.dataset.os));
  grupos.querySelectorAll("[data-frota-hist]").forEach(b => b.onclick = e => { e.stopPropagation(); abrirHistoricoFrota(b.dataset.frotaHist) });
  grupos.querySelectorAll("[data-toggle]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    const os = b.dataset.toggle, art = b.closest(".os"), aberto = expandidos.has(os);
    if (aberto) expandidos.delete(os); else expandidos.add(os);
    art.classList.toggle("os-open", !aberto);
    b.setAttribute("aria-expanded", String(!aberto));
  });
}

function opcoes() {
  const fill = (el, arr, lbl) => { el.innerHTML = `<option value="">${lbl}</option>` + arr.filter(Boolean).sort().map(x => `<option>${esc(x)}</option>`).join("") };
  fill(fAgrup, [...new Set(OS_LIST.map(o => o.agr))], "Todo agrupamento");
  fill(fEsp, [...new Set(OS_LIST.map(o => o.esp))], "Toda especialidade");
  fill(fModelo, [...new Set(OS_LIST.map(o => o.mod))], "Todo modelo");
  fill(fFrente, [...new Set(OS_LIST.map(o => o.frente))], "Toda frente / atividade");
  fill(fTipo, [...new Set(OS_LIST.map(o => o.tp))], "Interna, campo e externa");
  const nomes = [...new Set(OS_LIST.map(o => o.resp).filter(Boolean).concat(OS_LIST.map(o => o.respFr).filter(Boolean)))];
  dlResp.innerHTML = nomes.map(n => `<option value="${esc(n)}">`).join("");
  const ativs = [...new Set(OS_LIST.map(o => o.ativ).filter(Boolean))];
  dlAtiv.innerHTML = ativs.map(n => `<option value="${esc(n)}">`).join("");
  const frs = [...new Set(OS_LIST.map(o => o.fr).filter(Boolean))];
  dlFr.innerHTML = frs.map(n => `<option value="${esc(n)}">`).join("");
  fGroupBy.value = CONFIG.groupBy;
}

/* ============ modal ============ */
function achar(os) { return OS_LIST.find(o => o.os === os) }
function abrir(os) {
  abertaId = os; const o = achar(os);
  mFrota.innerHTML = o.veic + `<span>${esc(o.mod || "—")} · ${esc(o.esp)} · O.S. ${o.os}</span>`;
  mFrota.classList.add("clickable");
  mFrota.onclick = () => abrirHistoricoFrota(o.veic);
  const hist = o.retornos.slice().sort((a, b) => new Date(b.em) - new Date(a.em));
  mBody.innerHTML = `
  <div class="fs"><h4>Ficha do sistema</h4>
    <p style="margin:0;font-size:12.5px;line-height:1.6"><b>${esc(o.desc)}</b><br>
      ${esc(o.esp)} · ${esc(o.mod)}${o.marca ? " · " + esc(o.marca) : ""}<br>
      Aberta em ${fmt(o.ab)} · parada há <b>${dur(agora() - new Date(o.ab))}</b><br>
      ${o.mt} · ${o.tp} · ${esc(o.ofic)} · solicitante ${esc(o.sol) || "—"}${o.prog ? " · programada " + fmtd(o.prog) : ""}<br>
      <span style="color:var(--ink2)">${esc(o.prob)}</span></p></div>

  ${o.reinc ? `<div class="fs" style="border-left:3px solid var(--red)">
    <h4 style="color:var(--red)">Reincidência — ${o.reinc.n}ª ocorrência em ${CONFIG.reincDias} dias</h4>
    <p style="margin:0 0 8px;font-size:12.5px;line-height:1.6">${listaPares(o.reinc.pares, o)} — voltou em <b>${o.reinc.voltaEm} dia(s)</b>;
      as ocorrências anteriores somam <b>${o.reinc.horas}h</b> de máquina parada.</p>
    <ul style="margin:0;padding-left:16px;font-family:var(--mono);font-size:11px;color:var(--ink2);line-height:1.6">
      ${o.reinc.ant.slice(0, 8).map(h => `<li>${fmt(h.d)} · O.S. ${h.os}${h.t ? " · " + h.t.toFixed(1) + "h" : ""} — ${esc((h.x || "").slice(0, 60))}</li>`).join("")}</ul>
    <button class="btn btn-dark" style="margin-top:10px;background:var(--red)" id="btnCobrarModal">Gerar cobrança ao responsável</button>
    ${o.cobrado ? `<span style="margin-left:10px;display:inline-block;font-size:12px;color:var(--green);font-weight:700">✓ cobrada em ${fmt(o.cobrado)}</span>` : ""}
  </div>` : ""}

  <div class="fs"><h4>Classificação do problema (usada na reincidência)</h4>
    <ul class="itens-os">${itens(o).map(i => {
      const re = ((o.reinc && o.reinc.pares) || []).some(x => x.s === i.s && x.p === i.p);
      return `<li${re ? ' class="re"' : ""}><b>${esc(i.s)} · ${esc(i.p)}</b>${re ? " — reincidiu" : ""}${i.x ? `<em>${esc(i.x)}</em>` : ""}</li>`;
    }).join("")}</ul>
    <p class="hint">${itens(o).length > 1
      ? `A descrição lançou ${itens(o).length} problemas; todos entram na reincidência.`
      : "Classificação automática a partir do texto da O.S."}
      Para corrigir a leitura do texto, cadastre um termo em <b>Classificação</b> — vale para todas as O.S.</p>
  </div>

  <div class="fs"><h4>Acompanhamento</h4>
    <div class="row">
      <div class="f"><label>Pendência</label>
        <div class="picks" id="picks">${Object.keys(CONSTS.classes).filter(k => k !== "NAO").map(k => `<button class="pick ${o.classe === k ? 'on' : ''}" data-k="${k}">${CONSTS.classes[k].lbl}</button>`).join("")}</div></div>
      <div class="f"><label>Previsão de liberação do equipamento</label><input type="datetime-local" id="fPrevLib" value="${li(o.prevLib)}"></div>
    </div>
    <div class="f"><label>O que exatamente está travando</label>
      <textarea id="fDetalhe" class="alto" placeholder="Ex.: máquina montada, aguardando só a bomba hidráulica">${esc(o.detalhe)}</textarea></div>
    <p class="hint">Responsável: <b>${esc(o.respFr) || "sem responsável na frente"}</b> — vem da frente da frota ${o.veic},
      cadastrada em <b>Alocação de frota</b>, que é onde atividade, frente e responsável se alteram.</p></div>

  <div class="fs" id="boxMat" style="display:${o.classe === "MATERIAL" ? "block" : "none"}">
    <h4>Material — solicitação, pedido e ação pendente</h4>
    <div class="f"><label>Peça / componente</label><input id="fPeca" value="${esc(o.item.peca)}" placeholder="Compressor de ar"></div>
    <div class="row">
      <div class="f"><label>Nº da solicitação / requisição</label><input id="fSol" value="${esc(o.item.sol)}"></div>
      <div class="f"><label>Data e hora da solicitação</label><input type="datetime-local" id="fSolD" value="${li(o.item.solData)}"></div></div>
    <div class="row">
      <div class="f"><label>Nº do pedido de compra</label><input id="fPed" value="${esc(o.item.ped)}"></div>
      <div class="f"><label>Data e hora do pedido</label><input type="datetime-local" id="fPedD" value="${li(o.item.pedData)}"></div></div>
    <div class="f"><label>Ação que falta para a peça chegar</label>
      <select id="fAcao"><option value="">Selecione a ação pendente</option>
        ${CONSTS.acoes.map(a => `<option ${o.item.acao === a ? "selected" : ""}>${a}</option>`).join("")}
        ${o.item.acao && !CONSTS.acoes.includes(o.item.acao) ? `<option selected>${esc(o.item.acao)}</option>` : ""}
        <option value="__outra">Outra (escrever)</option></select></div>
    <div class="f" id="boxOutra" style="display:none"><label>Descreva a ação</label><input id="fAcaoTxt"></div>
    <div class="row3">
      <div class="f"><label>Quem tem que resolver</label><input id="fAcaoResp" value="${esc(o.item.acaoResp)}" placeholder="Compras, almoxarifado, fornecedor"></div>
      <div class="f"><label>Fornecedor</label><input id="fForn" value="${esc(o.item.fornec)}"></div>
      <div class="f"><label>Previsão de chegada</label><input type="date" id="fPrev" value="${ld(o.item.previsao)}"></div></div>
  </div>

  <div class="fs" id="boxMO" style="display:${o.classe === "MAO_OBRA" ? "block" : "none"}"><h4>Mão de obra</h4>
    <div class="row"><div class="f"><label>Mecânico / equipe</label><input id="fMec" value="${esc(o.mo.mecanico)}"></div>
    <div class="f"><label>Motivo da falta</label><input id="fCausa" value="${esc(o.mo.causa)}" placeholder="Equipe em outro atendimento, sem operador"></div></div></div>

  <div class="fs"><h4>Retornos — ${hist.length} registro(s)</h4>
    ${o.aberta ? `<div class="f"><label>Novo retorno</label><textarea id="fNovo" placeholder="O que foi feito ou combinado agora"></textarea></div>
    <div class="row"><div class="f"><label>Quem informou</label><input id="fAutor" placeholder="PCM, oficina, comprador"></div>
    <div class="f"><label>&nbsp;</label><button class="btn btn-dark" id="btnAddRet" style="width:100%;padding:9px">Adicionar retorno</button></div></div>` : ""}
    <ul class="tl">${hist.length ? hist.map(r => `<li><time>${fmt(r.em)}${r.autor ? " · " + esc(r.autor) : ""}</time><p>${esc(r.txt)}</p></li>`).join("") : '<li style="border:0;padding-left:0"><p style="color:var(--ink2)">Sem retornos. O relógio de cobrança corre desde a abertura.</p></li>'}</ul></div>`;

  mBody.querySelectorAll("#picks .pick").forEach(b => b.onclick = () => {
    mBody.querySelectorAll("#picks .pick").forEach(x => x.classList.remove("on")); b.classList.add("on");
    boxMat.style.display = b.dataset.k === "MATERIAL" ? "block" : "none";
    boxMO.style.display = b.dataset.k === "MAO_OBRA" ? "block" : "none";
  });
  const selAcao = document.getElementById("fAcao");
  if (selAcao) selAcao.onchange = () => { boxOutra.style.display = selAcao.value === "__outra" ? "block" : "none" };
  // lançou o número da solicitação/pedido, carimba a hora — é o instante em que
  // aconteceu, e ninguém ia digitar isso à mão. Só quando o campo está vazio,
  // pra não sobrescrever data que o PCM ajustou.
  carimbaAgora("fSol", "fSolD");
  carimbaAgora("fPed", "fPedD");
  const add = document.getElementById("btnAddRet");
  if (add) add.onclick = async () => {
    const t = document.getElementById("fNovo").value.trim();
    if (!t) { aviso("Escreva o retorno antes de adicionar."); return }
    try {
      await api(`/os/${encodeURIComponent(os)}/retorno`, { method: "POST", body: JSON.stringify({ txt: t, autor: document.getElementById("fAutor").value.trim() }) });
      await carregarOS(); aviso("Retorno registrado. Contagem zerada."); abrir(os); render();
    } catch (e) { aviso(e.message) }
  };
  const btnCobModal = document.getElementById("btnCobrarModal");
  if (btnCobModal) btnCobModal.onclick = () => cobrar(o.os);
  mask.classList.add("on");
}

async function salvarModal() {
  const sel = mBody.querySelector("#picks .pick.on");
  let acao = v("fAcao"); if (acao === "__outra") acao = v("fAcaoTxt");
  const payload = {
    classe: sel ? sel.dataset.k : "NAO", detalhe: v("fDetalhe"),
    prevLib: v("fPrevLib") ? new Date(v("fPrevLib")).toISOString() : "",
    item: { peca: v("fPeca"), sol: v("fSol"), solData: v("fSolD"), ped: v("fPed"), pedData: v("fPedD"), acao, acaoResp: v("fAcaoResp"), fornec: v("fForn"), previsao: v("fPrev") },
    mo: { mecanico: v("fMec"), causa: v("fCausa") },
  };
  try {
    await api(`/os/${encodeURIComponent(abertaId)}`, { method: "PATCH", body: JSON.stringify(payload) });
    await carregarOS(); mask.classList.remove("on"); opcoes(); render(); aviso("O.S. atualizada.");
  } catch (e) { aviso(e.message) }
}
async function retornoRapido(os) {
  const o = achar(os);
  const t = prompt("Retorno da O.S. " + os + " — frota " + o.veic + "\n\nO que mudou ou o que ficou combinado agora?");
  if (t === null || !t.trim()) return;
  try {
    await api(`/os/${encodeURIComponent(os)}/retorno`, { method: "POST", body: JSON.stringify({ txt: t.trim(), autor: "PCM" }) });
    await carregarOS(); render(); aviso("Retorno registrado. Contagem zerada.");
  } catch (e) { aviso(e.message) }
}
/* ============ histórico da frota ============ */
/* horas paradas no formato do relatório do PCM: 20897:49 em vez de 20897.8h */
function hm(h) {
  if (!h) return "—";
  return Math.floor(h) + ":" + String(Math.round(h % 1 * 60)).padStart(2, "0");
}
function dias(h) { return h ? (h / 24).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—" }

/* o back-end já manda a reincidência no topo; aqui só marca onde ela acaba */
function linhasHistorico(hist) {
  const liga = hist.filter(h => h.reAberta);
  const re = hist.filter(h => !h.reAberta && h.re);
  const resto = hist.filter(h => !h.reAberta && !h.re);
  // na parte de cima mostra o problema que REPETIU, não o principal da O.S. —
  // senão uma O.S. que voltou pelo motor aparecia rotulada como "preventiva",
  // que é só o primeiro item da descrição.
  const cel = h => (h.reAberta || h.re)
    ? (h.reAberta || h.re).map(p => `<b>${esc(p.s)}</b><br><span style="font-size:10.5px;color:var(--ink2)">${esc(p.p)}</span>`).join("<br>")
    : `${esc(h.s) || "—"}<br><span style="font-size:10.5px;color:var(--ink2)">${esc(h.p) || ""}</span>`;
  const tipo = m => m ? `<span class="tp-${esc(m).toLowerCase()}">${esc(m)}</span>` : "—";
  const linha = h => `<tr class="${h.reAberta ? "h-liga" : h.re ? "h-re" : ""}">
    <td class="n">${esc(h.os)}</td>
    <td class="n">${fmt(h.d)}</td>
    <td class="n">${h.lib ? fmt(h.lib) : "em aberto"}</td>
    <td class="n">${hm(h.t)}</td>
    <td class="n">${dias(h.t)}</td>
    <td>${tipo(h.m)}</td>
    <td>${cel(h)}</td>
    <td style="font-size:11.5px">${esc((h.x || "").slice(0, 140))}</td></tr>`;
  const div = (txt, cls) => `<tr class="h-div ${cls}"><td colspan="8">${txt}</td></tr>`;
  if (!liga.length && !re.length) return hist.map(linha).join("");
  return (liga.length ? div(`${liga.length} O.S. com o mesmo problema da O.S. aberta agora`, "liga") + liga.map(linha).join("") : "")
    + (re.length ? div(`outras ${re.length} O.S. que repetiram problema em ${CONFIG.reincDias} dias`, "re") + re.map(linha).join("") : "")
    + (resto.length ? div(`demais ${resto.length} O.S. do histórico`, "") + resto.map(linha).join("") : "");
}

async function abrirHistoricoFrota(veic) {
  let dados;
  try { dados = await api(`/frota/${encodeURIComponent(veic)}/historico`); }
  catch (e) { aviso(e.message); return; }
  fichaAberta = dados;   // o relatório de reincidência imprime exatamente o que está na tela
  const f = dados.frota || {}, aloc = dados.aloc || {}, rt = dados.retrabalho;
  const abertas = dados.abertas || [], hist = dados.historico || [];
  const frenteTxt = (aloc.ativ || aloc.fr) ? `${esc(aloc.ativ)} ${esc(aloc.fr)}`.trim() : "sem frente definida";
  fhFrota.innerHTML = veic + `<span id="fhSub">${esc(f.m || "—")} · ${esc(f.e || "")} · ${frenteTxt} · ${hist.length} O.S. no histórico</span>`;
  fhBody.innerHTML = `
    <div class="fs">
      <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin:0">
        <div class="kpi"><small>O.S. no histórico</small><b>${hist.length}</b><i>carregado pelo sync</i></div>
        <div class="kpi ${rt && rt.pc >= 50 ? 'alert' : ''}"><small>Retrabalho</small><b>${rt ? rt.pc + '%' : '—'}</b><i>${rt ? rt.re + ' de ' + rt.n + ' são repetição' : 'sem dados suficientes'}</i></div>
        <div class="kpi time"><small>Horas paradas</small><b>${rt ? Math.round(rt.h).toLocaleString('pt-BR') : 0}</b><i>${rt && rt.de ? 'desde ' + fmtd(rt.de) : '—'}</i></div>
      </div>
    </div>
    ${abertas.length ? `<div class="fs"><h4>O.S. aberta agora</h4>
      <ul class="tl">${abertas.map(o => `<li><time>${fmt(o.ab)}</time><p>${esc(o.prob) || "—"}</p></li>`).join("")}</ul></div>` : ""}
    <div class="fs" style="padding:0;overflow:auto;max-height:44vh">
      <table class="ct hist"><tr>
        <th>Nº O.S.</th><th>Data hora / parada</th><th>Data hora / liberação</th>
        <th>Horas P</th><th>Dias</th><th>Tipo</th><th>Sistema / problema</th><th>Descrição do problema</th></tr>
      ${linhasHistorico(hist)}
      </table>
      ${hist.length ? "" : `<p style="padding:20px;text-align:center;color:var(--ink2)">Nenhum histórico carregado para esta frota ainda.</p>`}
    </div>`;
  maskFrota.classList.add("on");
}
fhX.onclick = fhFechar.onclick = () => maskFrota.classList.remove("on");
maskFrota.onclick = e => { if (e.target === maskFrota) maskFrota.classList.remove("on") };

/* ============ carregamento ============ */
async function carregarOS() {
  OS_LIST = await api('/os');
}
function fmtSync(s) {
  if (!s) return "nunca";
  return new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
async function carregarSyncInfo() {
  try {
    const s = await api('/sync/info');
    stChip.textContent = "O.S.: " + fmtSync(s.abertasSyncEm) + " · Histórico até: " + fmtSync(s.historicoSyncAte);
    stChip.style.display = "inline-block";
  } catch (e) { /* não crítico */ }
}
async function carregarTudo() {
  const [consts, cfg] = await Promise.all([api('/constants'), api('/config')]);
  CONSTS = consts; CONFIG = cfg;
  document.getElementById("sla").value = CONFIG.sla;
  await carregarOS();
  opcoes(); render(); carregarSyncInfo();
}

async function atualizarAgora() {
  btnAtualizar.disabled = true;
  try {
    const r = await api('/sync/atualizar', { method: 'POST' });
    aviso(r.abertas + " O.S. abertas · " + r.frota + " frotas atualizadas. Histórico sincronizando…");
    await carregarOS(); opcoes(); render(); carregarSyncInfo();
    pollSyncStatus();
  } catch (e) { aviso(e.message) } finally { btnAtualizar.disabled = false }
}
function pollSyncStatus() {
  const t = setInterval(async () => {
    const s = await api('/sync/status');
    if (s.status === 'concluido') {
      clearInterval(t); aviso("Histórico sincronizado: " + s.novos + " O.S. novas."); await carregarOS(); render(); carregarSyncInfo();
    } else if (s.status === 'erro') { clearInterval(t); aviso("Falha no sync de histórico: " + s.mensagem); }
  }, 4000);
}

/* ============ relógio / eventos ============ */
function relogio() {
  const d = agora(); clk.textContent = d.toLocaleTimeString("pt-BR");
  clkd.textContent = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}
btnAtualizar.onclick = atualizarAgora;
chSemH.onclick = () => { filtro.semH = !filtro.semH; render() };
document.querySelectorAll(".kpi[data-filtro]").forEach(el => el.onclick = () => {
  const k = el.dataset.filtro;
  if (k === "mat") { filtro.classe = filtro.classe === "MATERIAL" ? "" : "MATERIAL"; fClasse.value = filtro.classe; }
  else filtro[k] = !filtro[k];
  render();
});
fAgrup.onchange = e => { filtro.agr = e.target.value; render() };
fFrente.onchange = e => { filtro.frente = e.target.value; render() };
fEsp.onchange = e => { filtro.esp = e.target.value; render() };
fModelo.onchange = e => { filtro.mod = e.target.value; render() };
fTipo.onchange = e => { filtro.tp = e.target.value; render() };
fClasse.onchange = e => { filtro.classe = e.target.value; render() };
fBusca.oninput = e => { filtro.busca = e.target.value; render() };
fGroupBy.onchange = async e => { CONFIG.groupBy = e.target.value; await api('/config', { method: 'PUT', body: JSON.stringify({ groupBy: CONFIG.groupBy }) }); render() };
document.getElementById("sla").onchange = async e => { const x = parseFloat(e.target.value); if (x > 0) { CONFIG.sla = x; await api('/config', { method: 'PUT', body: JSON.stringify({ sla: x }) }); render() } };
mX.onclick = () => mask.classList.remove("on");
mask.onclick = e => { if (e.target === mask) mask.classList.remove("on") };
mSalvar.onclick = salvarModal;
mExcluir.onclick = async () => {
  if (!confirm("Limpar os dados do PCM desta O.S.? A ficha do sistema continua na lista.")) return;
  try {
    await api(`/os/${encodeURIComponent(abertaId)}`, { method: "DELETE" });
    await carregarOS(); mask.classList.remove("on"); render(); aviso("Dados limpos.");
  } catch (e) { aviso(e.message) }
};

(async () => {
  relogio(); setInterval(relogio, 1000);
  try { await carregarTudo(); } catch (e) { aviso("Falha ao carregar dados: " + e.message); }
  setInterval(() => { if (!mask.classList.contains("on")) { carregarOS().then(render) } }, 60000);
})();
