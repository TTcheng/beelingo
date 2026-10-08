# BeeLingo · 蜂译

> 选中即译，蜂速可达 — 你的划词，你的 Key，你的隐私。
>
> A minimal on-selection AI translator for desktop browsers. Chrome/Edge MV3 + Firefox MV3, user-supplied API key, zero telemetry.

## 功能

- 划词后选区旁出现小蜜蜂图标，点击即翻译
- 快捷键 `Ctrl+Shift+Y`（macOS `Cmd+Shift+Y`）翻译当前选区
- 右键菜单「在蜂译中翻译」
- 译文气泡：5 秒自动收起；`Esc` / 点击别处 / 滚动超过 200px 也收起
- 语种：源 `自动 / 中 / 英 / 日 / 法 / 德 / 韩`，目标 `中 / 英 / 日 / 法 / 德 / 韩`
- 任意 OpenAI 兼容 `/v1/chat/completions` 服务（默认 MiniMax），Key 用户自备
- 令牌桶限流，默认 10 次/分钟

## 安装（开发者模式）

```bash
npm install
npm run build          # 或 build:chrome / build:firefox / build:all → 产物在 dist/<target>/
```

- **Chrome / Edge**：`chrome://extensions` → 开启开发者模式 → 加载已解压的扩展程序 → 选择 `dist/chrome/`
- **Firefox**：`about:debugging#/runtime/this-firefox` → 临时载入附加组件 → 选择 `dist/firefox/manifest.json`
  （Firefox 115–126 需在附加组件页手动开启「允许访问网站」，否则 content script 不会自动注入）

## 使用

1. 打开扩展设置页，填 API Key（默认端点 `https://api.MiniMax.chat/v1`，模型 `MiniMax-M3`）
2. 点「验证 Key」→ 扩展请求 `GET {apiBaseUrl}/models`
3. 在任意网页划选文字 → 点小蜜蜂图标 / 按快捷键 / 右键菜单

## 设置项

| 项 | 说明 |
|---|---|
| API Key | 存 `chrome.storage.local`，仅 background 可读 |
| API Base URL | OpenAI 兼容端点（含 `/v1`） |
| 模型 | 默认 `MiniMax-M3` |
| 思维链 | `关闭`（默认，直接出译文）/ `自适应` |
| 源 / 目标语言 | 见上 |
| 每分钟上限 | 令牌桶容量 5 / 10 / 20 / 30 |

「思维链=关闭」时请求体同时下发两家方言：MiniMax 的 `thinking:{type:'disabled'}` + `reasoning_split:false`，以及标准 `reasoning:{enabled:false}`（OpenRouter / OpenAI 系用）。`max_tokens` 额外预留 1024，兜底推理型模型的 reasoning 开销（否则空闲的 reasoning 会把额度吃光、返回空 content）。

## 错误码

气泡标题显示 `code`，正文是友好文案：

| code | 触发条件 |
|---|---|
| `NO_API_KEY` | 未配置 Key |
| `AUTH_ERROR` | HTTP 401 / 403（Key 无效或未授权） |
| `QUOTA_EXCEEDED` | HTTP 402（余额 / 配额不足） |
| `RATE_LIMIT` | HTTP 429，或本机令牌桶耗尽 |
| `NETWORK` | fetch 失败或 15s 超时 |
| `INVALID_TEXT` | 文本为空或超过 500 字符 |
| `PROVIDER_ERROR` | 5xx / 响应非法 / 输出被截断 |
| `UNKNOWN` | 其它 4xx |

## 架构

```
划词 → [content] 选区监听 → 小蜜蜂图标
        │ 点击 / 快捷键 / 右键菜单
        ▼
      [content] chrome.runtime.sendMessage(TRANSLATE_REQUEST)
        ▼
      [background] 令牌桶 → 读 settings → translate() → POST /chat/completions
        ▼
      [background] chrome.tabs.sendMessage(TRANSLATE_RESULT / TRANSLATE_ERROR)
        ▼
      [content] Shadow DOM 气泡渲染
```

- **Key 只存在于 background**：content 从不直接读 storage，也拿不到 Key，只能请求 background 代为翻译（受限流保护）。
- 响应由 background 主动用 `tabs.sendMessage` 推回，而非 `sendResponse`——Firefox ESR 上后者的异步通道不可靠。

### 目录

```
beelingo/
├── LICENSE
├── package.json · tsconfig.json · vitest.config.ts
├── vite.config.chrome.ts · vite.config.firefox.ts
├── scripts/
│   ├── build-content.mjs             # content → 经典脚本 IIFE（Chrome / Firefox 共用）
│   ├── build-firefox-background.mjs  # Firefox background → IIFE
│   └── generate-icon.py              # 生成各尺寸图标
├── public/_locales/{en,zh_CN}/messages.json
├── src/
│   ├── manifest.chrome.json · manifest.firefox.json
│   ├── popup.html · options.html
│   ├── content/    # index.ts · selection.ts · bubble.ts · style.css
│   ├── background/ # index.ts · rate-limit.ts
│   ├── popup/index.ts · options/index.ts
│   ├── shared/     # messaging/protocol.ts · storage/{keys,schema}.ts · translate/{client,languages}.ts
│   ├── icons/      # 16 / 32 / 48 / 96 / 128 PNG
│   └── types/global.d.ts
└── tests/setup.ts + tests/unit/*.test.ts
```

- MV3 的 `content_scripts` 与 `chrome.scripting.executeScript` 只接受**经典脚本**，所以 content 由 esbuild 打成单文件 IIFE（`scripts/build-content.mjs`，挂在 Vite `closeBundle` 上，`--watch` 也会重建）。
- Vite 负责 options / popup 页面与 Chrome 的 module service worker。

## 权限

```json
{
  "permissions": ["storage", "activeTab", "scripting", "contextMenus"],
  "host_permissions": ["https://*/*"]
}
```

`content_scripts.matches` 为 `<all_urls>`（划词需要在任意页面运行）；`host_permissions` 为 `https://*/*`，因为用户可把端点配成任意 OpenAI 兼容服务。除此之外无额外权限申请。

## 隐私

- 不收集任何数据，无遥测 / analytics。
- API Key 仅存本机 `chrome.storage.local`，扩展卸载即清空；不上传、不跨设备同步。
- 选中文本仅在触发翻译时发给你自己配置的端点。

## 开发

```bash
npm run dev          # vite build --watch（options / popup / Chrome background）
npm run dev:firefox
npm run type-check   # tsc --noEmit
npm test             # vitest 单元测试
```

改动 content script 后需到 `chrome://extensions` 点「重新加载」。

## 已知限制

- 不翻译 iframe 内的选区，仅顶层 frame。
- 无翻译缓存，每次触发都请求 API。
- 气泡显示时长固定 5 秒，未接入设置。
- manifest 的 `name` / `description` 是硬编码字面量，`_locales` 尚未通过 `__MSG_*__` 使用。
- 仓库未包含 ESLint 配置，`npm run lint` 目前会失败。

## License

[MIT](./LICENSE) © 2026 TTcheng