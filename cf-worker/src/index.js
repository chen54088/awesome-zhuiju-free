/**
 * 追剧聚合 · 采集源中转
 *
 * 这些苹果CMS 采集源都没有 Access-Control-Allow-Origin，浏览器不能直接读。
 * 这个 Worker 做三件事：
 *   1. 托管静态页面（ASSETS 绑定），和页面同源，省掉一个域名
 *   2. /src?u=...  只做「白名单 + 只读 + 有上限」的转发
 *   3. /ping        健康检查
 *
 * 白名单是构建时写死的（src/catalog.json），不接受任意 URL 转发，
 * 避免被当成公开的开放代理。
 */

import catalog from "./catalog.json";

const ALLOWED = new Set(catalog.catalog.map((c) => c.api));

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,OPTIONS",
  "access-control-allow-headers": "accept,content-type",
  "access-control-max-age": "86400",
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  ...CORS,
};

const UPSTREAM_TIMEOUT_MS = 9000;
const ALLOWED_QUERY = new Set(["ac", "wd", "t", "pg", "ids", "at", "limit", "h"]);

/** 只放行白名单内的 base（查询串由页面拼好），挡住 ?u= 后面夹带任意主机。 */
function normalizeTarget(raw, allowed) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;

  const base = `${url.origin}${url.pathname}`.replace(/\/$/, "");
  const match = [...allowed].find((api) => api.replace(/\/$/, "") === base);
  if (!match) return null;
  // 查询串只放行检索类参数，挡掉能改写源站行为的东西
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY.has(key)) return null;
  }
  url.searchParams.set("ac", url.searchParams.get("ac") === "list" ? "list" : "detail");
  return `${match}?${url.searchParams.toString()}`;
}

/** 部分采集源会在 JSON 前缀一段 HTML/广告，或返回 BOM，页面端解析前先剥干净。 */
function sanitize(text) {
  const start = text.indexOf("{");
  if (start <= 0) return text;
  const head = text.slice(0, start).trim();
  if (head === "" || head.startsWith("\uFEFF")) return text;
  return text.slice(start);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function proxy(request, allowed) {
  const target = normalizeTarget(new URL(request.url).searchParams.get("u") || "", allowed);
  if (!target) return json({ ok: false, error: "target_not_allowed" }, 403);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      method: "GET",
      redirect: "follow",
      signal: abort.signal,
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
    });

    // 不缓冲无限大的响应：大于 2MB 直接拒绝
    const length = Number(upstream.headers.get("content-length") || 0);
    if (length > 2 * 1024 * 1024) return json({ ok: false, error: "payload_too_large" }, 502);
    if (!upstream.ok) return json({ ok: false, error: "upstream_status", status: upstream.status }, 502);
    if (!upstream.body) return json({ ok: false, error: "empty_body" }, 502);

    // 流式透传 + 边转边剥前缀，避免 await text() 把整个响应吃进内存
    const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
    const encoder = new TextEncoder();
    let buffered = "";
    let stripped = false;

    const stream = new ReadableStream({
      async pull(controller) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            if (!stripped) controller.enqueue(encoder.encode(sanitize(buffered)));
            else if (buffered) controller.enqueue(encoder.encode(buffered));
            controller.close();
            return;
          }
          buffered += value;
          if (!stripped && buffered.length >= 512) {
            const clean = sanitize(buffered);
            stripped = true;
            controller.enqueue(encoder.encode(clean));
            buffered = "";
            return;
          }
          if (stripped) {
            controller.enqueue(encoder.encode(buffered));
            buffered = "";
            return;
          }
        }
      },
      cancel() {
        void reader.cancel();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30", ...CORS },
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "upstream_error";
    return json({ ok: false, error: reason }, 504);
  } finally {
    clearTimeout(timer);
  }
}

const defaultHandler = {
  /**
   * @param {Request} request
   * @param {{ ASSETS: Fetcher }} env
   * @param {Set<string>} [allowed]
   */
  async fetch(request, env, allowed = ALLOWED) {
    const url = new URL(request.url);
    if (url.pathname === "/src") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ ok: false, error: "method_not_allowed" }, 405);
      }
      return proxy(request, allowed);
    }
    if (url.pathname === "/ping") {
      return json({ ok: true, sources: allowed.size, edges: request.cf?.colo ?? "local" });
    }
    return env.ASSETS.fetch(request);
  },
};

export default defaultHandler;
