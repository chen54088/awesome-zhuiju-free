
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

// 中转：同源部署时直接 /src?u=；从 GitHub Pages 打开时用 WORKER_ORIGIN 写死的 Worker。
const WORKER_ORIGIN = window.HUB_WORKER_ORIGIN || "";
// 同源部署（Worker 自己托管）时用相对 /src；GitHub Pages 打开时用写死的 Worker 地址。
function viaProxy(api, query) {
  const target = withApi(api, query || "");
  const sameOrigin = !WORKER_ORIGIN || location.origin === new URL(WORKER_ORIGIN).origin;
  if (sameOrigin) return "/src?u=" + encodeURIComponent(target);
  return WORKER_ORIGIN.replace(/\/$/, "") + "/src?u=" + encodeURIComponent(target);
}
const hasProxy = () => location.protocol === "http:" || location.protocol === "https:";


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

// 速度标签颜色：<300ms 绿，<1s 蓝，其余 黄
function speedClass(ms) { return ms == null ? "speed-na" : ms < 300 ? "speed-fast" : ms < 1000 ? "speed-mid" : "speed-slow"; }

async function checkOne(api) {
  const t0 = performance.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    const res = await fetch(viaProxy(api, "ac=list"), { signal: ctl.signal, cache: "no-store" });
    clearTimeout(timer);
    const body = await res.json();
    const ok = res.ok && Array.isArray(body && body.list);
    SPEED.set(api, { ms: Math.round(performance.now() - t0), ok });
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
  const ok = [...SPEED.values()].filter((t) => t.ok).length;
  const total = CATALOG.length;
  const summary = `<div class="statline">${ok === total
    ? `<b class="ok">${ok}/${total}</b> 个源可用`
    : `<b class="${ok ? "" : "bad"}">${ok}/${total}</b> 个源可用${ok ? "" : "，中转可能没部署或当前网络不通"}`}</div>`;
  const rows = CATALOG.map((c) => {
    const t = SPEED.get(c.api) || { ok: false };
    const cls = t.ok ? "dot-ok" : "dot-bad";
    return `<span class="pill ${cls}" title="${esc(c.api)}"><i></i>${esc(c.name)}<b>${t.ok ? t.ms + "ms" : "×"}</b></span>`;
  }).join("");
  $("#status").innerHTML = summary + `<div class="pills">${rows}</div>`;
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
  const fastest = CATALOG.slice()
    .filter((c) => (SPEED.get(c.api) || {}).ok)
    .sort((a, b) => sourceScore(b) - sourceScore(a))
    .slice(0, 8)
    .map((c, i) => `${i + 1}. ${c.name}（${c.quality}，${(SPEED.get(c.api) || {}).ms}ms）`)
    .join("\n");
  $("#player").textContent =
    "本次实测可用的源，已按画质 + 速度排序：\n" + (fastest || "（测速未完成）") +
    "\n\n上面的 config.json 就是这份清单（全量版），点顶部按钮直接下载。\n" +
    "测速结果会因网络变化，重开本页就会重新排序。";
  $("#player").dataset.cfg = txt;
}

function rowCard(row) {
  const speedTag = row.ms != null ? `<span class="tag ${speedClass(row.ms)}">${row.ms}ms</span>` : "";
  const eps = row.eps.slice(0, 8).map((e) => `<a class="ep-btn" href="${esc(e.url)}" target="_blank" rel="noreferrer">${esc(e.name)}</a>`).join("");
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
  const tpl = (D.search_templates || {})[s.id] || s.search_url || "";
  const searchHref = tpl ? encodeURI(tpl.replace("{q}", QUERY)) : "";
  return `<div class="${cls}">
    <div class="art">${art}</div>
    <div class="body">
      <div class="title">${esc(s.name)}</div>
      <div class="meta"><span class="tag tag-rank">${rank}</span>${q}${geo}${ads}${fast}</div>
      <div class="src">${esc(s.note || "")}</div>
      <div class="btns">
        <a class="btn" href="${esc(s.url)}" target="_blank" rel="noreferrer">打开原站</a>
        ${searchHref
          ? `<a class="btn btn-primary" href="${esc(searchHref)}" target="_blank" rel="noreferrer">站内搜${QUERY ? "“" + esc(QUERY.slice(0, 8)) + "”" : ""}</a>`
          : `<a class="btn btn-disabled" href="${esc(s.url)}" target="_blank" rel="noreferrer">进站搜索</a>`}
      </div>
    </div>
  </div>`;
}

function renderSites() {
  $("#sites").innerHTML = `<div class="tiles">${D.sites.map((s, i) =>
    siteCard(s, "推荐 " + (i + 1))).join("")}</div>`;
  $("#sitesnote").textContent = "排序：可抓取程度 + 人工质量 + 首页实测耗时。广告标签表示维护者经验，不是实时结果。";
}

// 采集站没有 Access-Control-Allow-Origin，浏览器直连一定被拦，所以统一走 /src 中转。
async function searchOne(api, q) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(viaProxy(api, qs({ ac: "detail", wd: q })), { signal: ctl.signal, cache: "no-store" });
    const body = await res.json();
    if (!res.ok || !body || !Array.isArray(body.list)) return null;
    return body.list;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    return { c, list: list || [], raw: list, ms };
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
  const reachable = settled.filter((s) => s.raw !== null).length;
  if (ROWS.length) {
    $("#res").innerHTML =
      `<div class="hint">“${esc(QUERY)}” 在 <b>${SEARCHED}</b> / ${CATALOG.length} 个源命中，聚合 <b>${ROWS.length}</b> 部，耗时 ${took}ms。点任意集数直接播放。</div>` +
      ROWS.map(rowCard).join("");
  } else if (reachable === 0) {
    $("#res").innerHTML = `<div class="bad">
      中转没连上（0 / ${CATALOG.length} 个源返回数据）。<br><br>
      如果你的页面是 GitHub Pages 打开、而 Worker 还没部署，先按 README 部署 Worker 再刷新；<br>
      临时替代：往下滑用 <b>网站直达 → 站内搜</b>，或把 <b>config.json</b> 导入 FongMi / 影视仓。
    </div>`;
  } else {
    renderRows();
  }
  window.__lastSearch = { query: QUERY, hits: SEARCHED, reachable, groups: ROWS.length, ms: took };
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
  $("#chips").innerHTML = ["沙丘", "庆余年", "繁花", "三体", "流浪地球"].map((k) =>
    `<button class="chip" type="button" data-q="${esc(k)}">${esc(k)}</button>`
  ).join("");
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-q]");
    if (!b) return;
    $("#q").value = b.dataset.q;
    QUERY = b.dataset.q;
    runSearch();
  });
  renderEmpty();
  renderSites();
  renderPlayer();
  $("#status").innerHTML = `<span class="sub">测速中 0 / ${CATALOG.length}…</span>`;
  await preflight((n) => {
    $("#status").innerHTML = `<span class="sub">测速中 ${n} / ${CATALOG.length}…</span>`;
  });
  renderStatus();
  renderPlayer();
  const okCount = [...SPEED.values()].filter((t) => t.ok).length;
  if (okCount > 0) {
    $("#banner").classList.add("banner-ok");
    $("#banner").innerHTML = `中转正常：<b>${okCount}/${CATALOG.length}</b> 个源可用。输入片名或点上面热门词，直接搜。`;
  }
}

start();
}
boot();
