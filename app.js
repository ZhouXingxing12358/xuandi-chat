const $ = (id) => document.getElementById(id);

function md(text) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  let t = esc(text);
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = t.split("\n");
  const out = [];
  let list = [];
  const flush = () => {
    if (list.length) {
      out.push("<ul>" + list.map((x) => `<li>${x}</li>`).join("") + "</ul>");
      list = [];
    }
  };
  for (const line of lines) {
    const m = line.match(/^[-•]\s+(.*)/);
    if (m) list.push(m[1]);
    else if (/^\d+\.\s+/.test(line)) {
      flush();
      out.push(`<p>${line}</p>`);
    } else if (line.trim() === "") flush();
    else {
      flush();
      out.push(`<p>${line}</p>`);
    }
  }
  flush();
  return out.join("");
}

function addMsg(role, text) {
  const el = document.createElement("article");
  el.className = "msg " + role;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = role === "bot" ? "悬滴助手" : "你";
  el.appendChild(who);
  const body = document.createElement("div");
  body.innerHTML = md(text);
  el.appendChild(body);
  $("log").appendChild(el);
  $("log").scrollTop = $("log").scrollHeight;
}

function addTyping() {
  const el = document.createElement("article");
  el.className = "msg bot typing";
  el.id = "typing";
  el.innerHTML = '<span class="who">悬滴助手</span><div class="dots"><span></span><span></span><span></span></div>';
  $("log").appendChild(el);
  $("log").scrollTop = $("log").scrollHeight;
}

function removeTyping() {
  const el = $("typing");
  if (el) el.remove();
}

function setChips(items) {
  const box = $("chips");
  box.innerHTML = "";
  (items || []).forEach((q) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = q;
    b.addEventListener("click", () => send(q));
    box.appendChild(b);
  });
}

let currentId = "";
let currentCtx = null;
let catalog = [];
let busy = false;
let shareUrl = location.origin + location.pathname.replace(/\/index\.html?$/, "/");

function fillSelect(items) {
  const sel = $("exp");
  sel.innerHTML = "";
  if (!items.length) {
    sel.innerHTML = "<option>未发现实验数据</option>";
    return;
  }
  items.forEach((it, i) => {
    const o = document.createElement("option");
    o.value = it.id;
    o.textContent = `${it.label}${it.has_physics ? "" : "（尚无物理回传）"}`;
    sel.appendChild(o);
    if (!currentId && i === 0) currentId = it.id;
  });
  const alcohol = items.find((x) => String(x.id).includes("alcohol_vedio/30"));
  if (alcohol) {
    sel.value = alcohol.id;
    currentId = alcohol.id;
  } else {
    sel.value = currentId || items[0].id;
    currentId = sel.value;
  }
}

async function loadExp(id) {
  currentId = id;
  const item = catalog.find((x) => x.id === id);
  if (!item) {
    $("status").textContent = "未知批次";
    return;
  }
  const ctx = await fetch(item.data).then((r) => r.json());
  currentCtx = ctx;
  $("title").textContent = ctx.label;
  $("subtitle").textContent = ctx.physics || (ctx.phys && ctx.phys.poly_median != null)
    ? "可问整套流程，或问这一批的 γ / 门控 / 下一步"
    : "尚未对接 MATLAB；可问整套流程，或先问过程与门控";
  $("m-usable").textContent = ctx.n ? `${ctx.n_usable}/${ctx.n}` : "—";
  $("m-cred").textContent = ctx.cred ? `${Math.round(ctx.cred)}` : "—";
  $("m-gamma").textContent = ctx.phys && ctx.phys.poly_median != null
    ? Number(ctx.phys.poly_median).toFixed(2)
    : "未回传";
  $("status").textContent = ctx.cred_label || "批次已载入";
  $("status-mode").textContent = (ctx.physics || (ctx.phys && ctx.phys.poly_median != null))
    ? "物理已回传"
    : "仅过程评价";
  const img = $("thumb");
  if (item.best_image) {
    img.hidden = false;
    img.src = item.best_image;
    $("thumb-cap").textContent = ctx.best || "";
  } else {
    img.hidden = true;
    $("thumb-cap").textContent = "无最佳帧预览";
  }
}

async function send(text) {
  const q = (text || $("q").value || "").trim();
  if (!q || !currentCtx || busy) return;
  busy = true;
  $("q").value = "";
  const btn = document.querySelector(".send");
  if (btn) btn.disabled = true;
  addMsg("user", q);
  setChips([]);
  addTyping();
  await new Promise((r) => setTimeout(r, 180));
  try {
    const d = window.XuandiAgent.reply(q, currentCtx);
    removeTyping();
    addMsg("bot", d.text || "没有返回。");
    setChips(d.suggestions);
  } catch (e) {
    removeTyping();
    addMsg("bot", "本地规则引擎异常。");
  } finally {
    busy = false;
    if (btn) btn.disabled = false;
    $("q").focus();
  }
}

function greet() {
  const d = window.XuandiAgent.reply("你好", currentCtx);
  addMsg("bot", d.text);
  setChips(d.suggestions);
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  send();
});

$("exp").addEventListener("change", async (e) => {
  $("log").innerHTML = "";
  await loadExp(e.target.value);
  greet();
});

$("copy-lan").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareUrl);
    $("copy-lan").textContent = "已复制";
    setTimeout(() => { $("copy-lan").textContent = "分享"; }, 1400);
  } catch {
    $("copy-lan").textContent = "手动复制";
    setTimeout(() => { $("copy-lan").textContent = "分享"; }, 1400);
  }
});

(async function init() {
  try {
    const kb = await fetch("./knowledge.json").then((r) => r.json());
    if (window.XuandiAgent && window.XuandiAgent.setKnowledge) {
      window.XuandiAgent.setKnowledge(kb);
    }
  } catch {
    /* knowledge optional for local file open */
  }
  const meta = await fetch("./data/experiments.json").then((r) => r.json());
  catalog = meta.items || [];
  if (meta.public) shareUrl = String(meta.public).replace(/\/?$/, "/");
  else shareUrl = location.href.split("#")[0];
  const box = $("share");
  const code = $("url-lan");
  code.textContent = shareUrl;
  box.hidden = false;
  fillSelect(catalog);
  if (!currentId) {
    $("status").textContent = "没有实验数据。";
    return;
  }
  await loadExp(currentId);
  greet();
})();
