/* ============ cobrança de reincidência ============ */
function telLimpo(t) {
  let x = (t || "").replace(/\D/g, ""); if (!x) return "";
  if (x.length <= 11) x = "55" + x.replace(/^0+/, ""); return x;
}
function telsDe(contato) { if (!contato) return []; return (contato.tel || "").split(/[;,\/]+/).map(telLimpo).filter(Boolean) }

function montarDestinos(o, contatos) {
  const resp = ((o.resp || o.respFr || "").trim()).toUpperCase();
  const cMap = {}; contatos.forEach(c => cMap[c.nome] = c);
  const fix = contatos.filter(c => c.fixo);
  const lista = [];
  const add = (nome, motivo, marcado) => {
    if (!nome || lista.some(x => x.nome === nome)) return;
    const c = cMap[nome] || {};
    lista.push({ nome, funcao: c.funcao || "", email: c.email || "", tels: telsDe(c), motivo, marcado });
  };
  if (resp) add(resp, "responsável pela O.S.", true);
  fix.forEach(c => add(c.nome, c.funcao || "cópia fixa", true));
  nomesConhecidos(contatos).forEach(n => add(n, "", false));
  return lista;
}

function msgCobranca(o, dest) {
  const rc = o.reinc; if (!rc) return "";
  const resp = o.resp || o.respFr || "responsável";
  const L = [];
  L.push("COBRANÇA DE REINCIDÊNCIA — PCM · CRV Industrial · Unidade Capinópolis/MG");
  L.push("");
  L.push("Frota " + o.veic + " — " + (o.desc || o.mod || "") + (o.frente && o.frente !== "SEM FRENTE DEFINIDA" ? " · " + o.frente : ""));
  L.push("O.S. " + o.os + " aberta em " + fmt(o.ab) + " · parada há " + dur(agora() - new Date(o.ab)));
  const reps = (rc.pares && rc.pares.length ? rc.pares : [{ s: o.sisC, p: o.probC }]);
  L.push("Problema: " + reps.map(i => i.s + " — " + i.p).join(" + "));
  L.push("Relato da O.S.: " + (o.prob || "—"));
  L.push("");
  L.push("Esta é a " + rc.n + "ª ocorrência do MESMO problema nesta frota em " + CONFIG.reincDias + " dias.");
  L.push("A anterior foi em " + fmt(rc.ant[0].d) + " (O.S. " + rc.ant[0].os + ") — a falha voltou em " + rc.voltaEm + " dia(s).");
  L.push("As ocorrências anteriores somam " + rc.horas + " h de máquina parada.");
  const r = o.retrabalho;
  if (r && r.n >= 2) L.push("Índice de retrabalho desta frota no período: " + r.pc + "% (" + r.re + " das " + r.n + " O.S. corretivas são repetição), " + r.h + " h paradas.");
  L.push("");
  L.push("Histórico do problema nesta frota:");
  rc.ant.slice(0, 8).forEach(h => L.push("  • " + fmt(h.d) + " · O.S. " + h.os + (h.t ? " · " + h.t.toFixed(1) + "h paradas" : "") + " — " + (h.x || "")));
  if (rc.ant.length > 8) L.push("  • + " + (rc.ant.length - 8) + " ocorrência(s) no período");
  L.push("");
  L.push(resp.toUpperCase() + ", solicito retorno em até " + CONFIG.sla + " horas com:");
  L.push("  1) causa raiz identificada no reparo anterior;");
  L.push("  2) peça/componente substituído e nº da requisição;");
  L.push("  3) o que será feito agora para a falha não voltar;");
  L.push("  4) se o reparo anterior foi paliativo, qual a data prevista da correção definitiva.");
  L.push("");
  const cp = (dest || []).filter(x => x.marcado && x.nome !== resp.toUpperCase());
  if (cp.length) { L.push(""); L.push("Cópia: " + cp.map(x => x.nome + (x.funcao ? " (" + x.funcao + ")" : "")).join(", ") + "."); }
  L.push("");
  L.push("Mensagem gerada pelo painel de O.S. do PCM em " + agora().toLocaleString("pt-BR") + ".");
  return L.join("\n");
}

let cobOS = null, cobDestinos = [], cobContatos = [];
function destRender() {
  const o = achar(cobOS);
  cobDest.innerHTML = cobDestinos.map((x, i) => `
    <div class="dest ${x.marcado ? 'on' : ''}">
      <input type="checkbox" data-i="${i}" ${x.marcado ? "checked" : ""}>
      <div><div class="nm">${esc(x.nome)} ${x.motivo ? `<span class="badge-fix">${esc(x.motivo)}</span>` : ""}</div>
        <div class="fn">${esc(x.funcao) || "função não informada"}</div>
        <div class="${x.tels.length ? 'tl' : 'sem'}">${x.tels.length ? x.tels.map(t => "+" + t).join(" · ") : "sem WhatsApp cadastrado"}${x.email ? " · " + esc(x.email) : ""}</div></div>
      <div class="pp">${x.tels.map((t, j) => `<button data-zap="${t}">WhatsApp${x.tels.length > 1 ? " " + (j + 1) : ""}</button>`).join("")}</div>
    </div>`).join("");
  cobDest.querySelectorAll("input[type=checkbox]").forEach(c => c.onchange = () => {
    cobDestinos[+c.dataset.i].marcado = c.checked;
    txtCob.value = msgCobranca(o, cobDestinos); destRender();
  });
  cobDest.querySelectorAll("[data-zap]").forEach(b => b.onclick = () => abrirZap(b.dataset.zap));
  const n = cobDestinos.filter(x => x.marcado).length, semTel = cobDestinos.filter(x => x.marcado && !x.tels.length).length;
  cobSub.textContent = "Frota " + o.veic + " · O.S. " + o.os + " · " + n + " destinatário(s)" + (semTel ? " · " + semTel + " sem número" : "");
}
function abrirZap(tel) { window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(txtCob.value), "_blank") }
async function cobrar(os) {
  const o = achar(os); cobOS = os;
  cobContatos = await api('/contatos');
  cobDestinos = montarDestinos(o, cobContatos);
  txtCob.value = msgCobranca(o, cobDestinos);
  destRender();
  maskCob.classList.add("on");
}
async function marcarCobrada() {
  const nn = cobDestinos.filter(x => x.marcado).map(x => x.nome);
  try {
    await api(`/os/${encodeURIComponent(cobOS)}/cobrar`, { method: "POST", body: JSON.stringify({ destinatarios: nn }) });
    await carregarOS(); maskCob.classList.remove("on"); render(); aviso("Cobrança registrada e contagem de retorno zerada.");
  } catch (e) { aviso(e.message) }
}
function copiarCobranca() {
  navigator.clipboard.writeText(txtCob.value).then(() => aviso("Mensagem copiada."), () => { txtCob.select(); aviso("Selecione e copie a mensagem.") });
}
cX.onclick = () => maskCob.classList.remove("on");
maskCob.onclick = e => { if (e.target === maskCob) maskCob.classList.remove("on") };
cCopiar.onclick = copiarCobranca;
/* Sem API paga do WhatsApp: envio é sempre um clique = um destinatário, pelo
   botão "WhatsApp" de cada pessoa na lista acima (abrirZap). Nada de fila ou
   botão agregado — o navegador bloqueia popups automáticos além do primeiro
   por gesto do usuário, então "mandar pra todos de uma vez" não é confiável
   sem uma API paga. */
cMail.onclick = () => {
  const o = achar(cobOS);
  const mails = cobDestinos.filter(x => x.marcado && x.email).map(x => x.email).join(",");
  window.location.href = "mailto:" + mails + "?subject=" + encodeURIComponent("Reincidência — frota " + o.veic + " · O.S. " + o.os + " · " + o.probC) + "&body=" + encodeURIComponent(txtCob.value);
};
cFeito.onclick = marcarCobrada;

/* ============ resumo ============ */
function resumo() {
  const ab = filtrar().filter(o => o.aberta), al = ab.filter(vencida);
  let t = "PCM · O.S. ABERTAS — " + agora().toLocaleString("pt-BR") + "\n" + ab.length + " O.S. na seleção · " + al.length + " sem retorno há +" + CONFIG.sla + "h\n\n";
  al.slice(0, 40).forEach(o => {
    t += "• " + o.veic + " (" + o.esp + " / " + (o.mod || "—") + ") O.S. " + o.os + " — parado " + dur(agora() - new Date(o.ab)) + " | sem retorno " + dur(semRet(o)) + "\n"
      + "  Resp.: " + (o.resp || "não definido") + " | " + CONSTS.classes[o.classe].lbl
      + (o.classe === "MATERIAL" ? ": " + (o.item.peca || "peça não informada") + (o.item.sol ? " | solic. " + o.item.sol : " | SEM SOLICITAÇÃO") + (o.item.ped ? " | pedido " + o.item.ped : " | SEM PEDIDO") + (o.item.acao ? " | falta: " + o.item.acao : "") : "") + "\n"
      + "  " + (o.detalhe || o.prob || "") + "\n";
  });
  if (!al.length) t += "Nenhuma O.S. fora do prazo de retorno.\n";
  navigator.clipboard.writeText(t).then(() => aviso("Resumo copiado."), () => prompt("Copie o resumo:", t));
}
btnResumo.onclick = resumo;
