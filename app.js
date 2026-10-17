
"use strict";
async function boot() {
const D = window.HUB_DATA;
const CATALOG = D.catalog.filter(c => c.ok);
const QR = { "4K": 3, "蓝光": 2, "1080P": 1, "": 0 };
const SPEED = new Map();      // api -> {ms, ok}
let QUERY = "";
let ROWS = [];
let SEARCHED = 0;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function qs(o) { return Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&"); }
function withApi(api, q) { return api + (api.includes("?") ? "&" : "?") + q; }

function timing(api) {
  const t = SPEED.get(api);
  if (!t) return null;
  return t.ok ? t.ms : null;
}
function speedOf(api) { const ms = timing(api); return ms == null ? 0 : ms; }

// 苹果CMS 播放源：vod_play_from / vod_play_url 用 $$$ 和 # 分隔
function episodes(v) {
  const froms = String(v.vod_play_from || "").split("$$$");
  const urls = String(v.vod_play_url || "").split("$$$");
  const out = [];
  for (let i = 0; i < urls.length; i++) {
    const tag = froms[i] || "";
    for (const part of urls[i].split("#")) {
      const at = part.indexOf("$");
      if (at <= 0) continue;
      const name = part.slice(0, at);
      const url = part.slice(at + 1);
      if (!/^https?:/.test(url)) continue;
      out.push({ name, url, tag });
    }
  }
  return out;
}

// 速度条颜色：<300ms 绿，<1s 蓝，其余 黄
function speedClass(ms) { return ms == null ? "dim" : ms < 300 ? "good" : ms < 1000 ? "ok" : "slow"; }

async function checkOne(api) {
  const t0 = performance.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 9000);
    const res = await fetch(withApi(api, "ac=list"), { signal: ctl.signal, cache: "no-store" });
    clearTimeout(timer);
    await res.text();
    SPEED.set(api, { ms: Math.round(performance.now() - t0), ok: res.ok });
  } catch (e) {
    SPEED.set(api, { ms: 9999, ok: false });
  }
}

async function preflight(onProgress) {
  let done = 0;
  const tick = () => { done++; onProgress && onProgress(done); };
  await Promise.all(CATALOG.map(async (c) => {
    await checkOne(c.api);
    tick();
  }));
}

function renderStatus() {
  const posts = {};
  for (const [api, t] of SPEED) if (t.ok) posts[api] = t.ms;
  let html = "";
  for (const c of CATALOG) {
    const t = SPEED.get(c.api) || { ms: null, ok: false };
    html += `<span class="dot ${t.ok ? "ok" : "bad"}" title="${esc(c.api)}"></span>` +
      `<span title="${esc(c.api)}">${esc(c.name)} <b>${t.ok ? t.ms + "ms" : "×"}</b></span>`;
  }
  $("#status").innerHTML = html;
}

function sourceScore(c) {
  const ms = speedOf(c.api);
  return (QR[c.quality] || 0) * 1000 - ms;
}

function buildPlayerConfig() {
  const pick = CATALOG.slice()
    .sort((a, b) => sourceScore(b) - sourceScore(a))
    .filter((c) => (SPEED.get(c.api) || {}).ok !== false);
  return JSON.stringify({
    sites: pick.map((c, idx) => ({
      key: "hub_" + (idx + 1),
      name: c.name + " · " + c.quality,
      type: 1,
      api: c.api,
      searchable: 1,
      quickSearch: 1,
      filterable: 1,
    })),
  }, null, 2);
}

function renderPlayer() {
  const txt = buildPlayerConfig();
  $("#player").textContent =
    "# 每次打开本页，配置会自动更新为当天实测最快的几个源。\n" +
    "# 复制下面内容，保存成 config.json，再把地址填进 FongMi / 影视仓的接口。\n" + txt;
  $("#player").dataset.cfg = txt;
}

function rowCard(row) {
  const speedTag = row.ms != null ? `<span class="tag t${speedClass(row.ms)}">${row.ms}ms</span>` : "";
  const eps = row.eps.slice(0, 6).map((e) => `<a class="ep" href="${esc(e.url)}" target="_blank" rel="noreferrer">${esc(e.name)}</a>`).join("");
  const more = row.eps.length > 6 ? `<span class="sub">+${row.eps.length - 6} 集</span>` : "";
  return `<div class="group">
    <div class="ghead">
      <span class="badge2">${row.hits} 源</span>
      <span class="name">${esc(row.title)}</span>
      <span class="sub">${esc(row.year || "")} ${esc(row.type || "")}</span>
      <span style="flex:1"></span>
      <span class="sub">最佳 ${row.ms == null ? "-" : row.ms + "ms"}</span>
    </div>
    <div class="gbody" style="padding:10px 14px">
      ${eps}${more}
    </div>
    <div class="note">最佳源：${esc(row.best)} · ${row.state}${speedTag}</div>
  </div>`;
}

function siteCard(s, rank) {
  const art = esc((s.name || "?").slice(0, 1));
  const cls = ["tile", s.ads === 1 ? "ads1" : s.ads === 2 ? "ads2" : ""].join(" ");
  const q = s.quality ? `<span class="tag t${s.quality === "4K" ? "4k" : s.quality === "蓝光" ? "bd" : "1080"}">${s.quality}</span>` : "";
  const geo = s.geo === "需梯子" ? `<span class="tag" style="color:#d29922;border-color:#d29922">需梯子</span>` : "";
  const ads = s.ads === 0 ? `<span class="tag" style="color:#3fb950;border-color:#3fb950">无广告</span>` : "";
  const fast = s.ms != null ? `<span class="sub">${s.ms}ms</span>` : "";
  return `<div class="${cls}" onmouseenter="this.dataset.q=QUERY">
    <div class="art">${art}</div>
    <div class="body">
      <div class="title">${esc(s.name)}</div>
      <div class="meta"><span class="tag" style="color:#3fb950;border-color:#3fb950">${rank}</span>${q}${geo}${ads}${fast}</div>
      <div class="src">${esc(s.note || "")}</div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <a class="ep" style="flex:1;text-align:center" href="${esc(s.url)}" target="_blank" rel="noreferrer">打开原站</a>
        ${s.search_url ? `<a class="ep" style="flex:1;text-align:center" href="${esc(encodeURI(s.search_url.replace('{q}', QUERY)))}" target="_blank" rel="noreferrer">站内搜</a>` : ""}
      </div>
    </div>
  </div>`;
}

function renderSites() {
  const q = encodeURIComponent(QUERY);
  $("#sites").innerHTML = `<div class="tiles">${D.sites.map((s, i) =>
    siteCard(s, "推荐 " + (i + 1))).join("")}</div>`;
  $("#sitesnote").textContent = "排序：可抓取程度 + 人工质量 + 首页实测耗时。广告标签表示维护者经验，不是实时结果。";
}

async function searchOne(api, q) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    const res = await fetch(withApi(api, qs({ ac: "detail", wd: q })), { signal: ctl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const txt = await res.text();
    const start = txt.indexOf("{");
    if (start < 0) return null;
    const j = JSON.parse(txt.slice(start));
    return j && Array.isArray(j.list) ? j.list : null;
  } catch (e) { return null; }
}

function renderRows() {
  if (!QUERY) { $("#res").innerHTML = ""; return; }
  $("#res").innerHTML = ROWS.length
    ? ROWS.map(rowCard).join("")
    : `<div class="bad">没有源搜到“${esc(QUERY)}”。可以试试站内搜：${esc(D.sites.slice(0, 4).map(s => s.name).join(" / "))}，或换片名 / 英文名。</div>`;
}

function renderEmpty() {
  $("#res").innerHTML = `<div class="bad">输入片名开始搜索。也可以直接往下滑，用“网站直达”打开原站。</div>`;
}

// 多源并发搜索 + 去重聚合
// 同一部片在多个源里 vod_name 完全一致才算同一部；年份不同（如「沙丘」2021 / 「沙丘2」2024）分开。
async function runSearch() {
  const q = QUERY.trim();
  if (!q) return renderEmpty();
  $("#loadmore").style.display = "none";
  $("#res").innerHTML = `<div class="bad">正在并发搜索 ${CATALOG.length} 个源…</div>`;
  const t0 = performance.now();
  const settled = await Promise.all(CATALOG.map(async (c) => {
    const t = performance.now();
    const list = await searchOne(c.api, q);
    const ms = Math.round(performance.now() - t);
    return { c, list: list || [], ms };
  }));
  SEARCHED = settled.filter((s) => s.list.length).length;

  const groups = new Map();
  for (const { c, list, ms } of settled) {
    for (const v of list) {
      const key = (v.vod_name || "").trim().toLowerCase();
      if (!key) continue;
      // 片名必须包含关键词，过滤掉源站模糊匹配的无关结果
      if (!key.includes(q.toLowerCase())) continue;
      const eps = episodes(v);
      if (!eps.length) continue;
      const g = groups.get(key) || { title: v.vod_name, year: v.vod_year || "", type: v.type_name || "", hits: 0, eps: {}, sources: [] };
      g.hits++;
      g.sources.push({ name: c.name, quality: c.quality, ms, api: c.api });
      if (!g.year && v.vod_year) g.year = v.vod_year;
      if (!g.type && v.type_name) g.type = v.type_name;
      for (const e of eps) {
        const prev = g.eps[e.name];
        const rank = QR[c.quality] || 0;
        if (!prev || rank > prev.rank) g.eps[e.name] = { ...e, rank };
      }
      groups.set(key, g);
    }
  }
  ROWS = [...groups.values()].map((g) => {
    g.sources.sort((a, b) => (QR[b.quality] || 0) - (QR[a.quality] || 0) || a.ms - b.ms);
    const best = g.sources[0];
    return {
      ...g,
      best: best ? `${best.name} · ${best.quality}` : "",
      ms: best ? best.ms : null,
      eps: Object.values(g.eps),
      state: g.hits > 1 ? `${g.hits} 个源可看` : "单源",
    };
  }).sort((a, b) => {
    const qa = QR[(a.best || "").split("·").pop().trim()] || 0;
    const qb = QR[(b.best || "").split("·").pop().trim()] || 0;
    return qb - qa || b.hits - a.hits || (a.ms || 9e9) - (b.ms || 9e9);
  });
  const took = Math.round(performance.now() - t0);
  if (ROWS.length) {
    $("#res").innerHTML =
      `<div class="hint">“${esc(QUERY)}” 在 <b>${SEARCHED}</b> / ${CATALOG.length} 个源命中，聚合 <b>${ROWS.length}</b> 部，耗时 ${took}ms。点任意集数直接播放。</div>` +
      ROWS.map(rowCard).join("");
    window.__lastSearch = { query: QUERY, hits: SEARCHED, groups: ROWS.length, ms: took };
  } else {
    renderRows();
  }
}

function bind() {
  $("#q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { QUERY = $("#q").value; runSearch(); }
  });
  $("#go").addEventListener("click", () => { QUERY = $("#q").value; runSearch(); });
  $("#player").addEventListener("click", async () => {
    const txt = $("#player").dataset.cfg || buildPlayerConfig();
    try { await navigator.clipboard.writeText(txt); $("#player").insertAdjacentHTML("afterbegin", ""); } catch (e) {}
  });
}

async function start() {
  document.getElementById("gen").textContent = "更新 " + (D.generated_at || "").slice(0, 16).replace("T", " ");
  document.getElementById("gen2").textContent = D.generated_at || "";
  document.getElementById("ncat").textContent = CATALOG.length;
  bind();
  const siteChip = D.sites.length ? "" : "";
  $("#chips").innerHTML = CATALOG.slice(0, 8).map((c) =>
    `<span class="chip on">${esc(c.name)}${c.quality ? "·" + c.quality : ""}</span>`
  ).join("") + `<span class="chip">共 ${CATALOG.length} 个源</span>`;
  renderEmpty();
  renderSites();
  renderPlayer();
  $("#status").innerHTML = `<span class="sub">测速中 0 / ${CATALOG.length}…</span>`;
  await preflight((n) => {
    $("#status").innerHTML = `<span class="sub">测速中 ${n} / ${CATALOG.length}…</span>`;
  });
  renderStatus();
  renderPlayer();
}

start();
}
boot();
