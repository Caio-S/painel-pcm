/* ============ alocação de frota ============ */
let FROTA_LIST = [];
let aFiltro = { esp: "", busca: "", so: false };

async function alocRender() {
  if (!FROTA_LIST.length) FROTA_LIST = await api('/frota');
  const esps = [...new Set(FROTA_LIST.map(f => f.e))].filter(Boolean).sort();
  const q = aFiltro.busca.toLowerCase();
  let arr = FROTA_LIST.filter(f => {
    if (aFiltro.esp && f.e !== aFiltro.esp) return false;
    if (aFiltro.so && !(f.aloc.ativ || f.aloc.fr)) return false;
    if (q && !((f.c + " " + f.m + " " + f.e + " " + f.aloc.ativ + " " + f.aloc.fr).toLowerCase().includes(q))) return false;
    return true;
  });
  const total = arr.length; arr = arr.slice(0, 300);
  const alocadas = FROTA_LIST.filter(f => f.aloc.ativ || f.aloc.fr).length;
  aBody.innerHTML = `
   <div class="fs">
     <div class="alocbar">
       <select id="aEsp"><option value="">Toda especialidade</option>${esps.map(e => `<option ${aFiltro.esp === e ? "selected" : ""}>${esc(e)}</option>`).join("")}</select>
       <input type="search" id="aBusca" placeholder="Frota, modelo ou frente" value="${esc(aFiltro.busca)}">
       <label style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-size:12px;margin:0">
         <input type="checkbox" id="aSo" ${aFiltro.so ? "checked" : ""} style="width:auto"> só frotas já alocadas</label>
       <div class="grow"></div>
       <span style="font-size:12px;color:var(--ink2)">${alocadas} frota(s) alocada(s)</span>
     </div>
     <div class="alocbar" style="background:#F7F9FB;border:1px solid var(--line);border-radius:4px;padding:8px">
       <b style="font-size:11.5px">Aplicar aos ${arr.length} listados:</b>
       <input id="aBAtiv" placeholder="Atividade" list="dlAtiv" style="width:150px">
       <input id="aBFr" placeholder="Frente" list="dlFr" style="width:90px">
       <input id="aBResp" placeholder="Responsável da frente" list="dlResp" style="width:160px">
       <button class="btn btn-dark" id="aAplicar">Aplicar</button>
       <button class="btn btn-line" id="aLimpar">Limpar alocação dos listados</button>
     </div>
   </div>
   <div class="fs" style="padding:0;overflow:auto;max-height:46vh">
     <table class="al"><tr><th style="width:80px">Frota</th><th>Modelo</th><th>Especialidade</th>
       <th style="width:150px">Atividade</th><th style="width:90px">Frente</th><th style="width:160px">Responsável da frente</th></tr>
     ${arr.map(f => `<tr class="${f.aloc.ativ || f.aloc.fr ? 'tem' : ''}">
       <td class="f">${f.c}</td><td>${esc(f.m)}</td><td style="color:var(--ink2)">${esc(f.e)}</td>
       <td><input data-c="${f.c}" data-k="ativ" list="dlAtiv" value="${esc(f.aloc.ativ)}"></td>
       <td><input data-c="${f.c}" data-k="fr" list="dlFr" value="${esc(f.aloc.fr)}"></td>
       <td><input data-c="${f.c}" data-k="resp" list="dlResp" value="${esc(f.aloc.resp)}"></td></tr>`).join("")}
     </table></div>`;
  aInfo.textContent = (total > 300 ? "mostrando 300 de " + total + " frotas — refine o filtro" : total + " frota(s) listada(s)");

  aBody.querySelectorAll("table.al input").forEach(inp => inp.onchange = async () => {
    const c = inp.dataset.c, k = inp.dataset.k;
    const f = FROTA_LIST.find(x => x.c === c);
    // loc continua no payload mesmo sem campo na tela: o PUT grava os quatro
    // campos de uma vez, então omitir apagaria o local que veio dos relatórios.
    const novo = { ativ: f.aloc.ativ, fr: f.aloc.fr, resp: f.aloc.resp, loc: f.aloc.loc };
    novo[k] = inp.value.trim();
    try {
      f.aloc = await api(`/frota/${encodeURIComponent(c)}/alocacao`, { method: "PUT", body: JSON.stringify(novo) });
      await carregarOS(); opcoes(); render();
    } catch (e) { aviso(e.message) }
  });
  document.getElementById("aEsp").onchange = e => { aFiltro.esp = e.target.value; alocRender() };
  document.getElementById("aBusca").oninput = e => { aFiltro.busca = e.target.value; alocRender() };
  document.getElementById("aSo").onchange = e => { aFiltro.so = e.target.checked; alocRender() };
  document.getElementById("aAplicar").onclick = async () => {
    const at = document.getElementById("aBAtiv").value.trim(), fr = document.getElementById("aBFr").value.trim(),
      rs = document.getElementById("aBResp").value.trim();
    if (!at && !fr && !rs) { aviso("Preencha atividade, frente ou responsável antes de aplicar."); return }
    try {
      await api('/frota/alocacao/bulk', { method: "POST", body: JSON.stringify({ codigos: arr.map(f => f.c), ativ: at, fr, resp: rs }) });
      FROTA_LIST = []; await carregarOS(); opcoes(); render(); await alocRender(); aviso(arr.length + " frota(s) atualizada(s).");
    } catch (e) { aviso(e.message) }
  };
  document.getElementById("aLimpar").onclick = async () => {
    if (!confirm("Limpar a alocação das " + arr.length + " frotas listadas?")) return;
    try {
      await api('/frota/alocacao/limpar', { method: "POST", body: JSON.stringify({ codigos: arr.map(f => f.c) }) });
      FROTA_LIST = []; await carregarOS(); opcoes(); render(); await alocRender(); aviso("Alocação limpa.");
    } catch (e) { aviso(e.message) }
  };
}
btnAloc.onclick = async () => { maskAloc.classList.add("on"); await alocRender() };
aX.onclick = aFechar.onclick = () => maskAloc.classList.remove("on");
maskAloc.onclick = e => { if (e.target === maskAloc) maskAloc.classList.remove("on") };

/* ============ contatos ============ */
function nomesConhecidos(contatos) {
  const n = new Set();
  OS_LIST.forEach(o => { if (o.resp) n.add(o.resp.trim().toUpperCase()); if (o.respFr) n.add(o.respFr.trim().toUpperCase()) });
  contatos.forEach(c => n.add(c.nome));
  return [...n].sort();
}
async function contatosRender() {
  const contatos = await api('/contatos');
  const cMap = {}; contatos.forEach(c => cMap[c.nome] = c);
  const nomes = nomesConhecidos(contatos);
  ctBody.innerHTML = `
   <div class="fs">
     <div class="alocbar">
       <input id="ctNovo" placeholder="Adicionar responsável (nome)" style="min-width:230px">
       <input id="ctNovoTel" placeholder="WhatsApp (34 99999-9999)" style="min-width:180px">
       <button class="btn btn-dark" id="ctAdd">Adicionar</button>
       <div class="grow"></div><span style="font-size:12px;color:var(--ink2)">${nomes.length} responsável(is)</span>
     </div>
   </div>
   <div class="fs" style="padding:0;overflow:auto;max-height:46vh">
     <table class="ct"><tr><th>Responsável</th><th style="width:200px">WhatsApp</th><th style="width:170px">E-mail</th>
       <th style="width:160px">Função / equipe</th><th style="width:95px">Recebe sempre</th><th style="width:80px">Status</th><th style="width:40px"></th></tr>
     ${nomes.map(n => { const c = cMap[n] || { tel: "", funcao: "", email: "", fixo: false }; const temTel = !!(c.tel || "").trim();
      return `<tr><td class="n">${esc(n)}</td>
        <td><input data-n="${esc(n)}" data-k="tel" value="${esc(c.tel)}" placeholder="34 99999-9999"></td>
        <td><input data-n="${esc(n)}" data-k="email" value="${esc(c.email)}" placeholder="nome@crv.com.br"></td>
        <td><input data-n="${esc(n)}" data-k="funcao" value="${esc(c.funcao)}" placeholder="Gerência da oficina"></td>
        <td style="text-align:center"><input type="checkbox" data-n="${esc(n)}" data-k="fixo" ${c.fixo ? "checked" : ""} style="width:17px;height:17px"></td>
        <td class="${temTel ? 'zapok' : 'zapno'}">${temTel ? "com nº" : "sem número"}</td>
        <td style="text-align:center"><button class="btn btn-line" data-del="${esc(n)}" title="Apagar contato" style="padding:4px 8px;color:var(--red)">✕</button></td></tr>` }).join("")}
     </table></div>`;
  ctInfo.textContent = nomes.filter(n => (cMap[n] || {}).tel).length + " com WhatsApp · " + contatos.filter(c => c.fixo).length + " recebe(m) toda cobrança";
  ctBody.querySelectorAll("table.ct input").forEach(i => i.onchange = async () => {
    const n = i.dataset.n, c = Object.assign({ nome: n, tel: "", funcao: "", email: "", fixo: false }, cMap[n] || {});
    c[i.dataset.k] = i.type === "checkbox" ? i.checked : i.value.trim();
    try { await api('/contatos', { method: "PUT", body: JSON.stringify(c) }); await contatosRender(); } catch (e) { aviso(e.message) }
  });
  ctBody.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm(`Apagar o contato de ${b.dataset.del}? Se essa pessoa continuar como responsável em alguma O.S., ela volta a aparecer na lista sem os dados cadastrados.`)) return;
    try { await api(`/contatos/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" }); await contatosRender(); opcoes(); aviso("Contato apagado."); }
    catch (e) { aviso(e.message) }
  });
  document.getElementById("ctAdd").onclick = async () => {
    const n = document.getElementById("ctNovo").value.trim().toUpperCase();
    if (!n) { aviso("Escreva o nome do responsável."); return }
    try {
      await api('/contatos', { method: "PUT", body: JSON.stringify({ nome: n, tel: document.getElementById("ctNovoTel").value.trim() }) });
      await contatosRender(); opcoes(); aviso("Responsável cadastrado.");
    } catch (e) { aviso(e.message) }
  };
}
btnCont.onclick = async () => { maskCont.classList.add("on"); await contatosRender() };
ctX.onclick = ctFechar.onclick = () => maskCont.classList.remove("on");
maskCont.onclick = e => { if (e.target === maskCont) maskCont.classList.remove("on") };

/* ============ revisão de classificação ============ */
let clFiltro = { fam: "", busca: "" };
async function classRender() {
  const [cv, cl, regras] = await Promise.all([
    api('/classificacao/cobertura'),
    api('/classificacao/pendentes' + qs({ fam: clFiltro.fam, busca: clFiltro.busca })),
    api('/regras'),
  ]);
  clBody.innerHTML = `
  <div class="fs">
    <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin:0">
      <div class="kpi"><small>O.S. analisadas</small><b>${cv.tot.toLocaleString("pt-BR")}</b><i>histórico + abertas</i></div>
      <div class="kpi ${cv.pc >= 90 ? '' : 'alert'}"><small>Classificadas</small><b>${cv.pc}%</b><i>${cv.nc} sem classificação</i></div>
      <div class="kpi mat"><small>Textos diferentes a revisar</small><b>${cl.length}</b><i>agrupados por descrição</i></div>
    </div>
  </div>
  <div class="fs">
    <div class="alocbar">
      <select id="clFam"><option value="">Toda a frota</option>${Object.keys(CONSTS.familias).map(f => `<option value="${f}" ${clFiltro.fam === f ? "selected" : ""}>${CONSTS.familias[f]}</option>`).join("")}</select>
      <input type="search" id="clBusca" value="${esc(clFiltro.busca)}" placeholder="Procurar no texto da O.S." style="min-width:200px">
    </div>
  </div>
  <div class="fs" style="padding:0;overflow:auto;max-height:44vh">
    <table class="ct"><tr><th style="width:38%">Texto da O.S.</th><th style="width:11%">Ocorr.</th><th style="width:16%">Sistema</th><th style="width:20%">Problema</th><th style="width:15%">&nbsp;</th></tr>
    ${cl.map((c, i) => `<tr>
      <td>${esc(c.txt.slice(0, 90))}<br><span style="font-size:10.5px;color:var(--ink2)">${CONSTS.familias[c.fam] || c.fam} · frotas ${c.frotas.slice(0, 4).join(", ")}${c.frotas.length > 4 ? "…" : ""}</span></td>
      <td class="n">${c.n}${c.h ? "<br><span style='font-size:10px;color:var(--ink2)'>" + Math.round(c.h) + "h</span>" : ""}</td>
      <td><select data-i="${i}" data-k="sis">${CONSTS.sisLista.map(x => `<option>${x}</option>`).join("")}</select></td>
      <td><select data-i="${i}" data-k="prob"></select></td>
      <td><button class="btn btn-dark" data-apl="${i}" style="width:100%;padding:7px;font-size:11.5px">Classificar ${c.n}</button></td></tr>`).join("")}
    </table>
    ${cl.length ? "" : `<p style="padding:22px;text-align:center;color:var(--green);font-weight:700">Tudo classificado — nenhuma O.S. pendente de revisão.</p>`}
  </div>
  ${regras.length ? `<div class="fs"><h4>Regras criadas por você — ${regras.length}</h4>
    <div style="max-height:120px;overflow:auto">${regras.map(r => `<div class="dest" style="padding:5px 8px">
      <div><div class="nm">${esc(r.termo)}</div><div class="fn">${esc(r.s)} · ${esc(r.p)}</div></div>
      <div class="pp"><button data-del="${r.id}">Remover</button></div></div>`).join("")}</div></div>` : ""}`;

  const enche = i => { const sel = clBody.querySelector(`select[data-i="${i}"][data-k="sis"]`), pr = clBody.querySelector(`select[data-i="${i}"][data-k="prob"]`);
    pr.innerHTML = (CONSTS.probLista[sel.value] || ["Outros"]).map(x => `<option>${x}</option>`).join("") };
  cl.forEach((c, i) => enche(i));
  clBody.querySelectorAll('select[data-k="sis"]').forEach(sel => sel.onchange = () => enche(sel.dataset.i));
  clBody.querySelectorAll("[data-apl]").forEach(b => b.onclick = async () => {
    const i = +b.dataset.apl, c = cl[i];
    const sis = clBody.querySelector(`select[data-i="${i}"][data-k="sis"]`).value;
    const prob = clBody.querySelector(`select[data-i="${i}"][data-k="prob"]`).value;
    try {
      await api('/regras', { method: "POST", body: JSON.stringify({ termo: c.chave, fam: "*", s: sis, p: prob }) });
      await carregarOS(); render(); await classRender();
      aviso(c.n + " O.S. classificadas como " + sis + " · " + prob + ".");
    } catch (e) { aviso(e.message) }
  });
  clBody.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    try { await api(`/regras/${b.dataset.del}`, { method: "DELETE" }); await carregarOS(); render(); await classRender(); aviso("Regra removida."); }
    catch (e) { aviso(e.message) }
  });
  const f = document.getElementById("clFam"), q = document.getElementById("clBusca");
  if (f) f.onchange = () => { clFiltro.fam = f.value; classRender() };
  if (q) q.oninput = () => { clFiltro.busca = q.value; classRender() };
  clInfo.textContent = cv.pc + "% classificado · " + cv.nc + " O.S. pendentes";
}
function qs(obj) {
  const p = Object.entries(obj).filter(([, v]) => v).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return p.length ? "?" + p.join("&") : "";
}
btnCls.onclick = async () => { maskCls.classList.add("on"); await classRender() };
clX.onclick = clFechar.onclick = () => maskCls.classList.remove("on");
maskCls.onclick = e => { if (e.target === maskCls) maskCls.classList.remove("on") };
