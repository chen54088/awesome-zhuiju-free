# zhuiju-hub Worker

静态页面 + 采集源中转，部署后一个域名同时提供：

| 路径 | 作用 |
| --- | --- |
| `/` | 聚合页（与 `public/` 同源） |
| `/src?u=<采集源地址>` | 只转发白名单内的采集源，补上 CORS 头 |
| `/ping` | 健康检查，返回可用源数量与边缘节点 |
| `/status.html`、`/config.json` | 源状态页、播放器配置 |

## 安全边界

- `u` 只接受 `src/catalog.json` 中登记的 23 个采集源，其余一律 403，不是开放代理。
- 查询参数只允许 `ac / wd / t / pg / ids / at / limit / h`；`ac` 强制为 `list` 或 `detail`。
- 上游响应边读边剥前缀，不整体 `await text()`；声明长度超过 2 MB 直接拒绝。
- 上游 9 秒超时，错误统一返回 `{ok:false,error}`。

## 本地开发

```bash
npm install
npm run dev        # http://localhost:8787
npm run dry-run    # 只打包，不上传
```

## 部署

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
npm run deploy
```

部署完成会输出 `https://zhuiju-hub.<你的子域>.workers.dev`。
如果继续用 GitHub Pages 打开页面，把该地址填到 `out/site/index.html` 里
`window.HUB_WORKER_ORIGIN`（或直接使用 Worker 自己的域名访问，不需要这一步）。
