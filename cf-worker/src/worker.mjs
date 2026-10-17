/**
 * 追剧聚合 · 采集源中转（wrangler 构建入口，把白名单 JSON 内联进来）
 *
 * 静态页面由 Cloudflare 的 assets 直接托管，这个模块只处理 /src 和 /ping。
 */

import catalog from "./catalog.json" with { type: "json" };
import indexHandler from "./index.js";

export const ALLOWED = new Set(catalog.catalog.map((c) => c.api));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/src" || url.pathname === "/ping") {
      return indexHandler.fetch(request, env, ALLOWED);
    }
    return env.ASSETS.fetch(request);
  },
};
