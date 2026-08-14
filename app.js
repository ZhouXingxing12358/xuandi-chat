"use strict";

/** Bust GitHub Pages / browser cache when batch JSON or UI changes. */
const ASSET_V = "20260814c";
const withV = (url) => {
  const u = String(url || "");
  if (!u || u.startsWith("blob:") || u.startsWith("data:")) return u;
  return u + (u.includes("?") ? "&" : "?") + "v=" + ASSET_V;
};

const DEMO_EXPERIMENT = Object.freeze({
  name: "去离子水 · 25.1 ℃（演示）",
  surfaceTension: "71.96",
  confidence: "93",
  usable: "— / —",
  symmetry: "97.2%",
  imageQuality: "94",
  liquid: "去离子水",
  temperature: "25.1 ℃",
  bias: "演示",
  scale: "0.0132 mm/px",
  note: "演示数据，非实测；仅用于界面示意。"
});

const EMPTY = Object.freeze({
  surfaceTension: "--",
  confidence: "--",
  usable: "--",
  symmetry: "--",
  imageQuality: "--",
  liquid: "--",
  temperature: "--",
  bias: "--",
  scale: "--"
});

const DEMO_CTX = Object.freeze({
  id: "demo",
  label: "演示实验 · 去离子水",
  n: 0,
  n_usable: 0,
  usable_rate: 0,
  states: {},
  cred: 93,
  cred_label: "演示模式",
  best: "",
  best_score: null,
  phys: { poly_median: 71.96, px2mm: 0.0132, bias: null },
  consistency: {},
  physics: false,
  frames: [],
  _demo: true
});

const VIEW_CAPTIONS = {
  original: {
    real: "最佳评分帧原图预览（不等于一定准静态；算 γ 仍以 usable 为准）。",
    demo: "演示液滴原图示意，不是实测图。",
    empty: "选择左侧批次，或载入演示实验。",
    missing: "本批未打包该视图；当前仅有最佳帧原图。"
  },
  contour: {
    real: "本静态站未打包独立轮廓图；可问「轮廓门控过了吗」。",
    demo: "演示轮廓示意；未执行真实边缘检测。",
    empty: "尚未载入实验。",
    missing: "本批未打包轮廓视图。"
  },
  fit: {
    real: "主值来自 Poly；YL 只校验。本站未打包拟合叠加图。",
    demo: "演示拟合示意；未执行 Young–Laplace 求解。",
    empty: "尚未载入实验。",
    missing: "本批未打包拟合视图。"
  },
  residual: {
    real: "本站未打包残差图；可问「现在的误差如何」。",
    demo: "演示残差形态；数值为演示数据。",
    empty: "尚未载入实验。",
    missing: "本批未打包残差视图。"
  }
};

const state = {
  mode: "empty", // empty | real | demo | local
  activeView: "original",
  messages: [],
  catalog: [],
  currentId: "",
  currentCtx: null,
  bestImageUrl: "",
  realImage: null,
  localImage: null,
  localImageUrl: "",
  busy: false,
  shareUrl: ""
};

const el = {};
let toastTimer = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  try {
    const kb = await fetch(withV("./knowledge.json")).then((r) => r.json());
    if (window.XuandiAgent && window.XuandiAgent.setKnowledge) {
      window.XuandiAgent.setKnowledge(kb);
    }
  } catch (_) { /* optional */ }

  const meta = await fetch(withV("./data/experiments.json")).then((r) => r.json());
  state.catalog = meta.items || [];
  state.shareUrl = meta.public
    ? String(meta.public).replace(/\/?$/, "/")
    : location.href.split("#")[0];

  renderHistory();
  drawCurrentView();

  if (!state.catalog.length) {
    setEmptyUI("没有实验数据");
    showToast("未找到 data/experiments.json 批次");
    return;
  }

  const prefer = state.catalog.find((x) => x.id === "alcohol_vedio/30") || state.catalog[0];
  await loadRealBatch(prefer.id, { greet: true });
}

function cacheElements() {
  [
    "top-state-indicator", "top-state-text", "sidebar-experiment-name",
    "sidebar-experiment-detail", "sidebar-state-tag", "sidebar-context-status",
    "new-experiment-button", "module-assistant", "chat-scroll", "welcome-block",
    "message-list", "suggestion-section", "suggestion-grid", "suggestion-mode-tag",
    "image-input", "upload-button", "load-demo-button", "message-input", "send-button",
    "experiment-mode-badge", "clear-experiment-button", "experiment-canvas",
    "canvas-status", "demo-watermark", "local-watermark", "visual-caption",
    "results-data-tag", "primary-demo-tag", "surface-tension-value",
    "surface-tension-unit", "surface-tension-note", "confidence-value",
    "residual-value", "symmetry-value", "image-quality-value", "liquid-value",
    "temperature-value", "density-value", "scale-value", "parameters-data-tag",
    "help-button", "help-dialog", "help-close-button", "toast", "history-list",
    "assistant-status", "copy-share"
  ].forEach((id) => {
    el[toCamel(id)] = document.getElementById(id);
  });
  el.viewTabs = Array.from(document.querySelectorAll(".view-tab"));
  el.sidebarExperiment = document.querySelector(".sidebar-experiment");
}

function toCamel(id) {
  return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function bindEvents() {
  el.sendButton.addEventListener("click", () => send());
  el.messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  el.messageInput.addEventListener("input", resizeComposer);
  el.loadDemoButton.addEventListener("click", loadDemo);
  el.newExperimentButton.addEventListener("click", clearToEmpty);
  el.clearExperimentButton.addEventListener("click", clearToEmpty);
  el.uploadButton.addEventListener("click", () => el.imageInput.click());
  el.imageInput.addEventListener("change", onLocalImage);
  el.helpButton.addEventListener("click", openHelp);
  el.helpCloseButton.addEventListener("click", closeHelp);
  el.helpDialog.addEventListener("click", (e) => {
    if (e.target === el.helpDialog) closeHelp();
  });
  el.copyShare.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.shareUrl);
      showToast("已复制分享地址");
    } catch {
      showToast(state.shareUrl);
    }
  });
  el.viewTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeView = tab.dataset.view;
      el.viewTabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      updateCaption();
      drawCurrentView();
    });
  });
}

function renderHistory() {
  const box = el.historyList;
  box.replaceChildren();
  state.catalog.forEach((item) => {
    const art = document.createElement("article");
    art.className = "history-item";
    art.dataset.id = item.id;
    art.setAttribute("role", "button");
    art.tabIndex = 0;
    if (item.id === state.currentId && state.mode === "real") {
      art.classList.add("is-active");
    }
    art.innerHTML =
      '<span class="history-rail" aria-hidden="true"></span>' +
      `<div><strong>${escapeHtml(item.label)}</strong>` +
      `<small>${item.has_physics ? "物理已回传" : "仅过程评价"} · ${item.n_images || "?"} 帧</small></div>` +
      `<span class="history-demo-tag">${item.has_physics ? "REAL" : "AI"}</span>`;
    art.addEventListener("click", () => loadRealBatch(item.id, { greet: true }));
    art.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        loadRealBatch(item.id, { greet: true });
      }
    });
    box.appendChild(art);
  });
}

async function loadRealBatch(id, opts) {
  const item = state.catalog.find((x) => x.id === id);
  if (!item) return;
  const ctx = await fetch(withV(item.data)).then((r) => r.json());
  state.mode = "real";
  state.currentId = id;
  state.currentCtx = ctx;
  state.bestImageUrl = item.best_image ? withV(item.best_image) : "";
  state.localImage = null;
  if (state.localImageUrl) {
    URL.revokeObjectURL(state.localImageUrl);
    state.localImageUrl = "";
  }
  state.activeView = "original";
  syncViewTabs();
  await loadBestImage(state.bestImageUrl);
  applyRealMetrics(ctx, item);
  renderHistory();
  if (opts && opts.greet) {
    state.messages = [];
    greet();
  }
  renderMessages();
  updateCaption();
  drawCurrentView();
  showToast("已载入 " + ctx.label);
}

function applyRealMetrics(ctx, item) {
  const pst = ctx.phys || {};
  const gamma = pst.poly_median;
  const bestFrame = (ctx.frames || []).find((f) => f.path === ctx.best) || (ctx.frames || [])[0];
  const sym = bestFrame && bestFrame.score ? bestFrame.score.symmetry : null;
  const contour = bestFrame && bestFrame.score ? bestFrame.score.contour : null;

  el.moduleAssistant.dataset.experimentState = "loaded";
  el.topStateText.textContent = "真实批次 · " + ctx.label;
  el.topStateIndicator.classList.add("is-live");
  el.sidebarContextStatus.textContent = "真实批次";
  el.sidebarExperimentName.textContent = ctx.label;
  el.sidebarExperimentDetail.textContent =
    `usable ${ctx.n_usable}/${ctx.n}` + (gamma != null ? ` · γ ${Number(gamma).toFixed(2)}` : " · γ 未回传");
  el.sidebarStateTag.textContent =
    ctx.n_usable === 0 && gamma != null
      ? "OFFLINE"
      : ctx.physics || gamma != null
        ? "REAL"
        : "PROCESS";
  el.experimentModeBadge.textContent =
    ctx.n_usable === 0 && gamma != null ? "门控未放行 · 离线复算" : "真实批次";
  el.clearExperimentButton.hidden = false;
  el.assistantStatus.innerHTML = '<span aria-hidden="true"></span>规则引擎 · 当批 JSON';
  el.suggestionModeTag.textContent = "当批规则检索";
  el.demoWatermark.hidden = true;
  el.localWatermark.hidden = true;
  el.primaryDemoTag.hidden = true;
  el.canvasStatus.textContent = ctx.best || "已载入";
  if (ctx.n_usable === 0 && gamma != null) {
    el.resultsDataTag.textContent = "离线复算";
    el.primaryDemoTag.hidden = false;
    el.primaryDemoTag.textContent = "门控未放行";
  } else {
    el.resultsDataTag.textContent = "实测回传";
  }
  el.parametersDataTag.textContent = "批次参数";

  el.surfaceTensionValue.textContent = gamma != null ? Number(gamma).toFixed(2) : "未回传";
  el.surfaceTensionNote.textContent =
    ctx.n_usable === 0 && gamma != null
      ? "Poly 中位（离线复算）；本批 usable=0，非正式放行主结果"
      : "Andreas–Misak（Poly）中位；YL 仅校验";
  el.confidenceValue.textContent = ctx.cred != null ? String(Math.round(ctx.cred)) : "--";
  el.residualValue.textContent = ctx.n ? `${ctx.n_usable}/${ctx.n}` : "--";
  el.symmetryValue.textContent = sym != null ? `${sym.toFixed(1)}%` : "--";
  el.imageQualityValue.textContent = contour != null ? contour.toFixed(0) : "--";

  const parts = String(ctx.label).split(/[·・]/);
  el.liquidValue.textContent = (parts[0] || ctx.label).trim();
  el.temperatureValue.textContent = (parts[1] || "--").trim();
  el.densityValue.textContent =
    pst.bias != null ? `${(Number(pst.bias) * 100).toFixed(2)}% vs 文献` : "--";
  el.scaleValue.textContent = pst.px2mm != null ? Number(pst.px2mm).toFixed(5) : "--";
}

function loadDemo() {
  state.mode = "demo";
  state.currentId = "";
  state.currentCtx = { ...DEMO_CTX };
  state.bestImageUrl = "";
  state.realImage = null;
  state.localImage = null;
  state.activeView = "original";
  syncViewTabs();
  renderHistory();

  el.moduleAssistant.dataset.experimentState = "demo";
  el.topStateText.textContent = "演示实验";
  el.topStateIndicator.classList.add("is-live");
  el.sidebarContextStatus.textContent = "演示";
  el.sidebarExperimentName.textContent = DEMO_EXPERIMENT.name;
  el.sidebarExperimentDetail.textContent = "界面示意，非竞赛定稿数据";
  el.sidebarStateTag.textContent = "DEMO";
  el.experimentModeBadge.textContent = "演示实验";
  el.clearExperimentButton.hidden = false;
  el.assistantStatus.innerHTML = '<span aria-hidden="true"></span>演示模式';
  el.suggestionModeTag.textContent = "演示 + 知识库";
  el.demoWatermark.hidden = false;
  el.localWatermark.hidden = true;
  el.primaryDemoTag.hidden = false;
  el.canvasStatus.textContent = "DEMO";
  el.resultsDataTag.textContent = "演示数据";
  el.parametersDataTag.textContent = "演示参数";

  el.surfaceTensionValue.textContent = DEMO_EXPERIMENT.surfaceTension;
  el.surfaceTensionNote.textContent = DEMO_EXPERIMENT.note;
  el.confidenceValue.textContent = DEMO_EXPERIMENT.confidence;
  el.residualValue.textContent = DEMO_EXPERIMENT.usable;
  el.symmetryValue.textContent = DEMO_EXPERIMENT.symmetry;
  el.imageQualityValue.textContent = DEMO_EXPERIMENT.imageQuality;
  el.liquidValue.textContent = DEMO_EXPERIMENT.liquid;
  el.temperatureValue.textContent = DEMO_EXPERIMENT.temperature;
  el.densityValue.textContent = DEMO_EXPERIMENT.bias;
  el.scaleValue.textContent = DEMO_EXPERIMENT.scale;

  state.messages = [];
  addUserMsg("载入演示实验");
  addBotMsg(
    "已载入**演示实验**（带 DEMO 水印）。数字只为界面示意。\n\n要看真实结果，请点左侧批次，例如乙醇水溶液 · 30°C。也可直接问：本实验的原理是什么？",
    ["本实验的原理是什么？", "现在的误差如何？", "切换到真实批次"],
    true
  );
  updateCaption();
  drawCurrentView();
  showToast("已载入演示实验");
}

function clearToEmpty() {
  state.mode = "empty";
  state.currentId = "";
  state.currentCtx = null;
  state.bestImageUrl = "";
  state.realImage = null;
  state.messages = [];
  state.activeView = "original";
  syncViewTabs();
  renderHistory();
  setEmptyUI("未载入实验");
  setChips([
    "本实验的原理是什么？",
    "数据处理怎么做？",
    "载入演示实验",
    "误差来源有哪些？"
  ]);
  renderMessages();
  updateCaption();
  drawCurrentView();
  showToast("已清空工作区");
}

function setEmptyUI(statusText) {
  el.moduleAssistant.dataset.experimentState = "empty";
  el.topStateText.textContent = statusText || "未载入实验";
  el.topStateIndicator.classList.remove("is-live");
  el.sidebarContextStatus.textContent = "尚未载入";
  el.sidebarExperimentName.textContent = "等待开始";
  el.sidebarExperimentDetail.textContent = "选择左侧批次或载入演示实验";
  el.sidebarStateTag.textContent = "EMPTY";
  el.experimentModeBadge.textContent = "尚未载入";
  el.clearExperimentButton.hidden = true;
  el.assistantStatus.innerHTML = '<span aria-hidden="true"></span>规则引擎';
  el.suggestionModeTag.textContent = "知识库";
  el.demoWatermark.hidden = true;
  el.localWatermark.hidden = true;
  el.primaryDemoTag.hidden = true;
  el.canvasStatus.textContent = "等待输入";
  el.resultsDataTag.textContent = "暂无数据";
  el.parametersDataTag.textContent = "等待实验";
  el.surfaceTensionValue.textContent = EMPTY.surfaceTension;
  el.surfaceTensionNote.textContent = "Andreas–Misak（Poly）中位；YL 仅校验";
  el.confidenceValue.textContent = EMPTY.confidence;
  el.residualValue.textContent = EMPTY.usable;
  el.symmetryValue.textContent = EMPTY.symmetry;
  el.imageQualityValue.textContent = EMPTY.imageQuality;
  el.liquidValue.textContent = EMPTY.liquid;
  el.temperatureValue.textContent = EMPTY.temperature;
  el.densityValue.textContent = EMPTY.bias;
  el.scaleValue.textContent = EMPTY.scale;
}

function onLocalImage(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (state.localImageUrl) URL.revokeObjectURL(state.localImageUrl);
  state.localImageUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.localImage = img;
    state.mode = "local";
    state.currentCtx = null;
    state.currentId = "";
    el.moduleAssistant.dataset.experimentState = "local";
    el.topStateText.textContent = "本地预览 · 未分析";
    el.sidebarContextStatus.textContent = "本地预览";
    el.sidebarExperimentName.textContent = file.name;
    el.sidebarExperimentDetail.textContent = "仅浏览器预览，未跑门控或物理反演";
    el.sidebarStateTag.textContent = "LOCAL";
    el.experimentModeBadge.textContent = "本地预览";
    el.clearExperimentButton.hidden = false;
    el.demoWatermark.hidden = true;
    el.localWatermark.hidden = false;
    el.primaryDemoTag.hidden = true;
    el.canvasStatus.textContent = "未分析";
    ["surfaceTensionValue", "confidenceValue", "residualValue", "symmetryValue", "imageQualityValue"].forEach((k) => {
      el[k].textContent = "--";
    });
    el.surfaceTensionNote.textContent = "本地预览未计算 γ";
    el.liquidValue.textContent = "--";
    el.temperatureValue.textContent = "--";
    el.densityValue.textContent = "--";
    el.scaleValue.textContent = "--";
    el.resultsDataTag.textContent = "未分析";
    el.parametersDataTag.textContent = "本地文件";
    state.messages = [];
    addBotMsg(
      "已载入本地图片预览，**未**做轮廓门控或物理反演。请从左侧选择真实批次查询 γ 与误差。",
      ["本实验的原理是什么？", "数据处理怎么做？"]
    );
    updateCaption();
    drawCurrentView();
    showToast("本地预览已载入");
  };
  img.src = state.localImageUrl;
}

function loadBestImage(url) {
  return new Promise((resolve) => {
    if (!url) {
      state.realImage = null;
      resolve();
      return;
    }
    const img = new Image();
    img.onload = () => {
      state.realImage = img;
      resolve();
    };
    img.onerror = () => {
      state.realImage = null;
      resolve();
    };
    img.src = url;
  });
}

function syncViewTabs() {
  el.viewTabs.forEach((t) => {
    const on = t.dataset.view === state.activeView;
    t.classList.toggle("is-active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function updateCaption() {
  const pack = VIEW_CAPTIONS[state.activeView] || VIEW_CAPTIONS.original;
  if (state.mode === "demo") el.visualCaption.textContent = pack.demo;
  else if (state.mode === "empty") el.visualCaption.textContent = pack.empty;
  else if (state.mode === "local") el.visualCaption.textContent = "本地图片预览，未分析。";
  else if (state.activeView === "original" && state.realImage) el.visualCaption.textContent = pack.real;
  else if (state.activeView === "original") el.visualCaption.textContent = "本批暂无最佳帧预览图。";
  else el.visualCaption.textContent = pack.missing;
}

/* ---------- chat ---------- */

function greet() {
  if (!state.currentCtx || !window.XuandiAgent) return;
  const d = window.XuandiAgent.reply("你好", state.currentCtx);
  addBotMsg(d.text || "", d.suggestions || []);
}

async function send(text) {
  const q = (text || el.messageInput.value || "").trim();
  if (!q || state.busy) return;

  if (q === "载入演示实验" || q.includes("载入演示")) {
    el.messageInput.value = "";
    loadDemo();
    return;
  }
  if (q.includes("切换到真实") || q === "真实批次") {
    el.messageInput.value = "";
    const prefer = state.catalog.find((x) => x.id === "alcohol_vedio/30") || state.catalog[0];
    if (prefer) await loadRealBatch(prefer.id, { greet: true });
    return;
  }

  state.busy = true;
  el.messageInput.value = "";
  resizeComposer();
  el.sendButton.disabled = true;
  addUserMsg(q);

  const ctx = state.currentCtx || {
    id: "empty",
    label: "未载入实验",
    n: 0,
    n_usable: 0,
    usable_rate: 0,
    states: {},
    cred: 0,
    cred_label: "",
    best: "",
    best_score: null,
    phys: {},
    consistency: {},
    physics: false,
    frames: []
  };

  await sleep(120);
  try {
    const d = window.XuandiAgent.reply(q, ctx);
    addBotMsg(d.text || "没有返回。", d.suggestions || [], state.mode === "demo");
  } catch (err) {
    addBotMsg("本地规则引擎异常。", ["本实验的原理是什么？", "现在的误差如何？"]);
  } finally {
    state.busy = false;
    el.sendButton.disabled = false;
    el.messageInput.focus();
  }
}

function addUserMsg(text) {
  state.messages.push({ role: "user", text, ts: new Date(), demo: false });
  renderMessages();
}

function addBotMsg(text, chips, demo) {
  state.messages.push({
    role: "assistant",
    text,
    ts: new Date(),
    demo: !!demo
  });
  setChips(chips || []);
  renderMessages();
}

function setChips(items) {
  const grid = el.suggestionGrid;
  grid.replaceChildren();
  (items || []).forEach((q) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "suggestion-chip";
    b.innerHTML = `<span>${escapeHtml(q)}</span><span aria-hidden="true">↗</span>`;
    b.addEventListener("click", () => send(q));
    grid.appendChild(b);
  });
}

function renderMessages() {
  el.messageList.replaceChildren();
  el.welcomeBlock.hidden = state.messages.length > 0;
  state.messages.forEach((m) => {
    const article = document.createElement("article");
    article.className = "message " + m.role;
    const marker = document.createElement("span");
    marker.className = "message-marker";
    marker.setAttribute("aria-hidden", "true");
    const head = document.createElement("div");
    head.className = "message-head";
    const author = document.createElement("strong");
    author.textContent = m.role === "assistant" ? "悬滴法AI助手" : "你";
    head.appendChild(author);
    if (m.role === "assistant" && m.demo) {
      const badge = document.createElement("span");
      badge.className = "reply-badge";
      badge.textContent = "演示模式";
      head.appendChild(badge);
    }
    const time = document.createElement("time");
    time.textContent = formatTime(m.ts);
    head.appendChild(time);
    const body = document.createElement("div");
    body.className = "message-body";
    body.innerHTML = md(m.text);
    article.append(marker, head, body);
    el.messageList.appendChild(article);
  });
  if (state.messages.length) {
    requestAnimationFrame(() => {
      el.chatScroll.scrollTop = el.chatScroll.scrollHeight;
    });
  }
}

function md(text) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  let t = esc(String(text || ""));
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

function formatTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function resizeComposer() {
  const input = el.messageInput;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 92) + "px";
}

function openHelp() {
  if (typeof el.helpDialog.showModal === "function") el.helpDialog.showModal();
  else el.helpDialog.setAttribute("open", "");
}

function closeHelp() {
  if (typeof el.helpDialog.close === "function" && el.helpDialog.open) el.helpDialog.close();
  else el.helpDialog.removeAttribute("open");
}

function showToast(message) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => el.toast.classList.remove("is-visible"), 2800);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------- canvas ---------- */

function drawCurrentView() {
  const canvas = el.experimentCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  drawBase(ctx, canvas.width, canvas.height);

  if (state.mode === "local" && state.localImage) {
    drawImageFit(ctx, canvas.width, canvas.height, state.localImage);
    return;
  }
  if (state.mode === "demo") {
    drawDemoView(ctx, canvas.width, canvas.height, state.activeView);
    return;
  }
  if (state.mode === "real" && state.activeView === "original" && state.realImage) {
    drawImageFit(ctx, canvas.width, canvas.height, state.realImage);
    return;
  }
  if (state.mode === "real") {
    drawMissingView(ctx, canvas.width, canvas.height, state.activeView);
    return;
  }
  drawEmpty(ctx, canvas.width, canvas.height);
}

function drawBase(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#081520");
  g.addColorStop(1, "#050c14");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.strokeStyle = "rgba(104, 151, 183, 0.10)";
  for (let x = 55; x < w; x += 55) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 55; y < h; y += 55) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawImageFit(ctx, w, h, img) {
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawEmpty(ctx, w, h) {
  const cx = w / 2;
  const cy = h / 2 - 18;
  ctx.save();
  ctx.strokeStyle = "rgba(84, 155, 184, 0.38)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 9]);
  ctx.beginPath();
  ctx.moveTo(cx, cy - 92);
  ctx.bezierCurveTo(cx - 54, cy - 44, cx - 64, cy + 22, cx, cy + 86);
  ctx.bezierCurveTo(cx + 64, cy + 22, cx + 54, cy - 44, cx, cy - 92);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(181, 207, 221, 0.78)";
  ctx.font = "600 18px Segoe UI, Microsoft YaHei UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("尚未载入实验", cx, cy + 128);
  ctx.fillStyle = "rgba(139, 173, 194, 0.62)";
  ctx.font = "12px Segoe UI, Microsoft YaHei UI, sans-serif";
  ctx.fillText("选择左侧批次或载入演示实验", cx, cy + 151);
  ctx.restore();
}

function drawMissingView(ctx, w, h, view) {
  if (state.realImage && view === "original") {
    drawImageFit(ctx, w, h, state.realImage);
    return;
  }
  const cx = w / 2;
  const cy = h / 2;
  ctx.save();
  ctx.fillStyle = "rgba(181, 207, 221, 0.78)";
  ctx.font = "600 16px Segoe UI, Microsoft YaHei UI, sans-serif";
  ctx.textAlign = "center";
  const titles = { contour: "轮廓图未打包", fit: "拟合叠加图未打包", residual: "残差图未打包" };
  ctx.fillText(titles[view] || "视图不可用", cx, cy);
  ctx.fillStyle = "rgba(139, 173, 194, 0.62)";
  ctx.font = "12px Segoe UI, Microsoft YaHei UI, sans-serif";
  ctx.fillText("可在对话中询问门控 / 误差 / Poly–YL", cx, cy + 28);
  if (state.realImage) {
    ctx.globalAlpha = 0.25;
    drawImageFit(ctx, w, h, state.realImage);
  }
  ctx.restore();
}

function drawDemoView(ctx, w, h, view) {
  if (view === "residual") {
    drawResidualDemo(ctx, w, h);
    return;
  }
  const cx = w / 2;
  const cy = h / 2 - 10;
  ctx.save();
  ctx.fillStyle = "rgba(120, 170, 200, 0.15)";
  ctx.beginPath();
  ctx.moveTo(cx, cy - 100);
  ctx.bezierCurveTo(cx - 70, cy - 40, cx - 80, cy + 40, cx, cy + 110);
  ctx.bezierCurveTo(cx + 80, cy + 40, cx + 70, cy - 40, cx, cy - 100);
  ctx.fill();
  ctx.strokeStyle = view === "contour" ? "rgba(120, 220, 255, 0.9)" : "rgba(180, 210, 230, 0.7)";
  ctx.lineWidth = view === "contour" ? 2.5 : 2;
  ctx.stroke();
  if (view === "fit") {
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(255, 180, 100, 0.85)";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 95);
    ctx.bezierCurveTo(cx - 66, cy - 38, cx - 76, cy + 38, cx, cy + 105);
    ctx.bezierCurveTo(cx + 76, cy + 38, cx + 66, cy - 38, cx, cy - 95);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(200, 220, 235, 0.55)";
  ctx.font = "12px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText("DEMO · " + String(view).toUpperCase(), cx, h - 36);
  ctx.restore();
}

function drawResidualDemo(ctx, w, h) {
  ctx.save();
  const mid = h / 2;
  ctx.strokeStyle = "rgba(100, 160, 190, 0.4)";
  ctx.beginPath();
  ctx.moveTo(40, mid);
  ctx.lineTo(w - 40, mid);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 160, 120, 0.85)";
  ctx.beginPath();
  for (let x = 40; x < w - 40; x += 4) {
    const y = mid + Math.sin(x / 28) * 18 + Math.sin(x / 11) * 6;
    if (x === 40) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = "rgba(200, 220, 235, 0.55)";
  ctx.font = "12px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText("DEMO RESIDUAL", w / 2, h - 36);
  ctx.restore();
}
