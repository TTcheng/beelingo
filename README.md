# BeeLingo · 蜂译

> 选中即译，蜂速可达 — 你的划词，你的 Key，你的隐私。
>
> A lightweight, on-selection AI translator for desktop browsers. Chrome MV3 + Firefox MV3, user-supplied API Key, zero telemetry.

## 目录

- [项目概览](#项目概览)
- [用户故事](#用户故事)
- [快速上手](#快速上手)
- [仓库结构](#仓库结构)
- [技术栈](#技术栈)
- [双平台差异点](#双平台差异点)
- [划词翻译流程](#划词翻译流程)
- [API Key 与安全设计](#api-key-与安全设计)
- [缓存策略](#缓存策略)
- [MVP 验收清单](#mvp-验收清单)
- [开发者贡献指南](#开发者贡献指南)
- [后续路线（M1–M4）](#后续路线m1m4)
- [路线图时间表](#路线图时间表)
- [隐私声明](#隐私声明)
- [FAQ](#faq)
- [致谢 / License](#致谢--license)

---

## 项目概览

**BeeLingo（蜂译）** 是一款桌面浏览器划词翻译扩展。它在用户用鼠标划选一段文字后，于选区附近弹出一个小气泡，立即给出译文。

我们做这件事的边界非常明确：

- **不**做全功能翻译工具（不替代专业桌面翻译软件）
- **不**做沉浸式整页翻译（避免破坏排版、增加性能开销）
- **不**做广告 / 推荐 / 增值订阅
- **只**做一件事：**划词 → 即时译文**

围绕这一点，扩展提供了：

1. **悬浮小蜜蜂图标** — 划词后在选区右上角出现，点击触发翻译
2. **快捷键唤起** — `Ctrl+Shift+Y`（macOS 为 `Cmd+Shift+Y`）无需鼠标
3. **译文气泡** — 显示译文、音标（可选）、复制按钮、收藏入口
4. **6+ 语种方向** — 中↔英、中↔日、英↔日、法↔中、德↔中、韩↔中
5. **用户自带 Key** — OpenAI 兼容协议，默认指向 `api.MiniMax.chat/v1`

代码库以「配置 + 源码 + 文档 + 脚本」组织：一个 `src/` 目录容纳所有业务代码，三个 manifest 模板出 Chrome / Firefox / 共用版本，一个 `scripts/` 目录处理打包与发布。

---

## 用户故事

下面五个典型场景描述了 BeeLingo 服务的真实用户。每个故事以第一人称视角写。

### 故事 1：技术博客重度读者

> 我每天读 5–10 篇英文技术博客。看到陌生术语时，我希望不离开当前页面就能知道它的含义。

我在 GitHub README 里划选 "Pareto-optimal trade-off between latency and recall" 这句，蜂译气泡立刻在选区下方给出译文，并对 "Pareto-optimal" 加了下划线作为术语提示，我可以一键加入生词本。整个过程无需切换窗口，注意力不被打破。

### 故事 2：考研 / 留学备考者

> 我需要在 PDF 与网页混合阅读中积累大量学术词汇。

我在 PDF.js 阅读器里选中 "self-attention mechanism"，蜂译给出「自注意力机制」并显示音标 /ˌsɛlf əˈtɛnʃən ˈmɛkəˌnɪzəm/。气泡上的「⭐ 加入生词本」按钮把词条按时间顺序存到本地，方便晚上统一复习。

### 故事 3：跨境购物用户

> 我买东西时需要看英文商品参数表，但只想快速看懂关键差异。

我打开一款进口耳机的 Amazon 详情页，选中 "driver diameter: 40mm dynamic, frequency response 20Hz–20kHz"，蜂译给出对照译文。我点气泡上的「📋 复制」按钮，把译文粘到备忘录里发给中文朋友。不需要切换词典软件。

### 故事 4：跨境电商运营 / 产品经理

> 我要快速浏览英文 SaaS Newsletter 把握要点。

我连续读 10 篇相同领域的 SaaS 文章，蜂译的二级缓存让重复短语（"ARR", "MRR", "churn rate"）在 < 100ms 内出结果。第一次的等待是一次性的，之后的阅读是连续的。

### 故事 5：语言学习者

> 我想练习英语阅读，但偶尔需要中文作为「拐杖」。

我把蜂译的「仅快捷键触发」模式打开（不是划一下就弹），只在遇到不确定的词时主动按 `Ctrl+Shift+Y`。这样既保留了英语环境，又不会因为频繁弹气泡打断阅读流。

---

## 快速上手

下面是从安装到第一次成功翻译的完整流程。

### 1. 安装扩展

**Chrome / Edge 用户**：

1. 打开 Chrome Web Store，搜索「BeeLingo 蜂译」（暂未上线，待发布）
2. 点击「添加至 Chrome」

**Firefox 用户**：

1. 打开 Firefox Add-ons (AMO)，搜索「BeeLingo 蜂译」
2. 点击「添加到 Firefox」

**本地开发者模式**（开发期间）：

```bash
git clone <repo-url> beelingo
cd beelingo
pnpm install
pnpm build           # 产物输出到 dist/
# Chrome：打开 chrome://extensions → 开启「开发者模式」→ 加载已解压的扩展程序 → 选择 dist/chrome/
# Firefox：打开 about:debugging#/runtime/this-firefox → 临时载入附加组件 → 选择 dist/firefox/manifest.json
```

### 2. 授予权限

首次安装后浏览器会询问：

- `activeTab`：用户主动点击图标或快捷键时获取当前标签页访问权
- `storage`：用于保存 API Key / 缓存 / 生词本

点接受即可。**BeeLingo 不申请 `<all_urls>`**，所有翻译只发生在当前活动 Tab。

### 3. 配置 API Key

1. 点击工具栏的蜂译图标，弹窗显示「设置」
2. 在「API Key」输入框填入你自己的 OpenAI 兼容 Key（默认 `https://api.MiniMax.chat/v1`）
3. 点击「验证 Key」按钮，扩展会向该 API 发起一次最小请求验证 Key 有效性
4. 选择「源语言」与「目标语言」（默认 auto → 中文）

### 4. 第一次翻译

1. 打开一篇英文文章
2. 按住鼠标左键划选一段文字
3. 选区右上角出现小蜜蜂图标，**点击图标** 或按 `Ctrl+Shift+Y`
4. 约 1–2 秒后，译文气泡在选区附近出现
5. 5 秒后气泡自动收起；按 `Esc` 或点击页面其他区域也可收起

如果气泡没出现，请参考 [FAQ](#faq) 中的「气泡不弹出怎么办」。

---

## 仓库结构

```
beelingo/
├── README.md                   # 你正在读的这份
├── LICENSE                     # MIT
├── package.json
├── tsconfig.json               # strict: true
├── vite.config.ts              # 通用 Vite 配置
├── vite.config.chrome.ts       # Chrome 专用覆写
├── vite.config.firefox.ts      # Firefox 专用覆写
├── scripts/
│   ├── zip.mjs                 # 打包 dist/ 为 zip 上传 CWS / AMO
│   ├── check-i18n.mjs          # 检查 _locales/*.json 完整性
│   └── bump-version.mjs        # 统一版本号
├── public/
│   ├── icons/                  # 16 / 32 / 48 / 96 / 128 PNG
│   └── _locales/
│       ├── en/messages.json
│       └── zh_CN/messages.json
└── src/
    ├── manifest.base.json      # 双平台共享 manifest
    ├── manifest.chrome.json    # Chrome 覆写
    ├── manifest.firefox.json   # Firefox 覆写（含 browser_specific_settings）
    ├── content/                # 划词监听 + 悬浮图标 + 译文气泡
    │   ├── index.ts
    │   ├── selection.ts
    │   ├── bubble.ts
    │   └── style.css
    ├── background/             # Service Worker，唯一持有 API Key
    │   ├── index.ts
    │   ├── messages.ts
    │   └── rate-limit.ts       # 令牌桶
    ├── popup/                  # 工具栏弹窗：开关 + 最近翻译
    │   ├── index.html
    │   └── main.ts
    ├── options/                # API Key / 语种 / 快捷键 / 黑名单
    │   ├── index.html
    │   ├── main.ts
    │   └── form.ts
    ├── shared/
    │   ├── translate/          # API 客户端 + prompt 模板 + 语种常量
    │   ├── storage/            # storage key 常量 + zod schema
    │   ├── messaging/          # content↔bg 消息协议
    │   ├── i18n/
    │   ├── hotkey/             # 默认快捷键常量
    │   └── utils/
    └── types/                  # 全局类型 + chrome API 补丁
```

`vite.config.chrome.ts` / `vite.config.firefox.ts` 通过 `define` 注入 `__TARGET__ = 'chrome'` 或 `'firefox'`，业务代码用 `if (__TARGET__ === 'firefox')` 处理极少数平台差异。Manifest 通过 `vite-plugin-static-copy` 把对应 `src/manifest.*.json` 复制到 `dist/<target>/manifest.json`。

---

## 技术栈

| 层级 | 技术 | 选型理由 |
|------|------|---------|
| 扩展规范 | Chrome MV3 + Firefox MV3 | 当前双平台最新规范，service worker + host_permissions 明确 |
| 语言 | TypeScript（strict） | 消息协议 / storage schema 都是结构化数据，类型收益大 |
| 框架 | **原生 JS / TS**，不引入 React / Vue | 扩展运行时（content script）体积敏感；UI 只有气泡 + Popup + Options，组件化收益小 |
| 构建 | Vite 5 + `@crxjs/vite-plugin` | MV3 扩展官方构建链路，HMR 对 Popup / Options 友好 |
| 校验 | zod | storage 数据 / 消息 payload 在 runtime 校验 |
| 样式 | CSS Variables（明暗主题） + 原生 CSS | 不引入 Tailwind 等，避免 content script 注入体积爆炸 |
| i18n | `chrome.i18n` + `_locales/*.json` | MV3 标准方案，Web Store 自动翻译 |
| 测试 | Vitest（单元）+ Playwright（E2E） | 业界标准，覆盖 shared 工具 + 完整划词链路 |

不引入的：React/Vue/Svelte、UI 组件库、Tailwind、状态管理库（Zustand 等）、数据库（SQLite 等）。**代码即配置，体积即体验**。

---

## 双平台差异点

代码层面差异 < 5 行（`if (__TARGET__)` 分支），主要差异在 manifest 和打包产物。

| 维度 | Chrome MV3 | Firefox MV3 | BeeLingo 处理 |
|------|-----------|-------------|--------------|
| Service Worker 生命周期 | 30s 无事件即终止 | Firefox 128+ 同样采用 event-page 风格，但 `chrome.runtime.connect` 长连接更稳 | 关键状态（限流计数、session 缓存）放 `chrome.storage.session`，**不依赖**模块顶层变量 |
| `chrome.commands` 全局快捷键 | manifest 声明 `Ctrl+Shift+Y` | Mac 上需额外声明 `"mac": "Command+Shift+Y"` | `manifest.firefox.json` 注入 Mac 分支 |
| `host_permissions` | 必填，否则 `fetch` 跨域会被 CORS / CORB 拦 | Firefox 处理宽松但仍建议显式声明 | manifest 写 `"host_permissions": ["https://api.MiniMax.chat/*"]`，用户可改但**不允许**通配符 |
| `web_accessible_resources` | 必填 | 同 | 仅图标资源，UI 全在 Shadow DOM 内 |
| 后台脚本 | 仅 `service_worker` | 也支持 `scripts` 数组（持久 background） | MVP 只声明 `service_worker` |
| `browser_specific_settings` | 不需要 | **AMO 必填**，否则拒收 | `manifest.firefox.json` 注入 `"gecko": { "id": "beelingo@<your-domain>", "strict_min_version": "115.0" }` |
| 扩展 ID | CWS 自动分配固定 ID | AMO 可自选 jti；临时安装 ID 会变 | 开发期用 `chrome.runtime.id` 即可，不依赖持久化 ID |
| 审核 | Chrome Web Store 审核 | AMO 审核更严，需源码或详尽说明 | 不引入远程代码；README 写清每个权限用途 |
| Permissions 最小集 | `storage` / `activeTab` / `scripting` / `contextMenus` | 同 | 不申请 `<all_urls>`；只声明 API 主机的 host_permissions |

代码层面唯一可能分支：`contextMenu` API 在 Firefox 上文本项略不同（`contexts: ['selection']` 即可，双平台一致），无需 if 判断。

---

## 划词翻译流程

完整流程涉及 4 个上下文：Content Script、Background Service Worker、外部翻译 API、Popup/Options 持久化层。

```
用户在页面划选文字
       │
       ▼
[content] mouseup + selectionchange 监听（节流 200ms）
       │ ① window.getSelection().toString() 取文本
       │ ② 长度校验 1–500 字符，黑名单域名跳过
       │ ③ 计算选区矩形 (getBoundingClientRect)
       ▼
[content] 在选区右上角渲染小蜜蜂图标（Shadow DOM）
       │
       ├──[用户点击小蜜蜂]──────────┐
       │                            │
[用户按 Ctrl+Shift+Y]               │
       │                            │
       ▼                            ▼
[content] chrome.runtime.sendMessage({type: 'TRANSLATE_REQUEST', text, rect})
       │
       ▼
[background] 消息路由 + 限流检查（令牌桶 10 req/min）
       │
       ├──[命中 L1 内存缓存]───▶ 直接返回译文
       ├──[命中 L2 storage]────▶ 直接返回译文
       ▼
[background] translate/client.ts 调用 OpenAI 兼容 /chat/completions
       │  Key 从 chrome.storage.local 读取
       │  Prompt：translate-only system + 原文 user
       ▼
[API] 返回 {choices: [{message: {content: "..."}}]}
       │
       ▼
[background] 标准化为 TranslationResult
       │  异步写入 L1 + L2 缓存
       │  sendMessage 回传给 content script
       ▼
[content] 在选区附近渲染译文气泡（Shadow DOM）
       │ 5 秒自动收起 / Esc / 点击外部收起
       ▼
[用户] ⭐ 收藏 → sendMessage('ADD_WORD') → storage.local.favorites
```

补充几个易错点：

- **节流必须做**：高频 `selectionchange` 不节流会被 Chrome 性能监控识别为「影响页面」
- **气泡防溢出**：选区贴近视口右 / 下边缘时气泡自动反向偏移；视口高度 < 600px（分屏）切换为左侧锚定
- **跨域 iframe**：MVP 暂不支持 iframe 内划词，仅顶层 frame。这是已知限制
- **AbortController**：content script 监听新的 mouseup 时主动 abort 上次 fetch，避免乱序响应覆盖新选区

---

## API Key 与安全设计

API Key 是扩展最有价值的东西——泄露它等于用户被刷量 / 被盗刷。

**Key 只在 background 上下文存在**：

```
用户输入 (Options / Popup)
       │
       ▼
chrome.storage.local.set({ apiKey: 'sk-xxxx' })
       │
       ▼
[background service worker]
  读取 → 用于 fetch /chat/completions
  永不向 content script 或网页暴露
```

**Content Script 永远拿不到 Key**。即使网页脚本注入攻击成功，也只能调 `sendMessage({type: 'TRANSLATE_REQUEST'})` 让 background 翻译，受令牌桶限流保护。

**存储位置**：

- ✅ `chrome.storage.local`：本机加密存储，扩展卸载即清空
- ❌ `chrome.storage.sync`：**禁用**，避免多设备同步泄露 Key
- ❌ Cookie / localStorage：无法跨 extension context 共享，扩展也读不到

**传输层**：

- 所有外部请求走 `https://`，禁用 HTTP 明文
- 默认 Base URL `https://api.MiniMax.chat/v1`，用户在 Options 可改但**不允许**通配符（防止被改成钓鱼端点）

**显示层**：

- Options 页 API Key 默认 `type=password`，点「显示」后 10 秒自动隐藏
- 「显示」按钮要求二次确认（防误触）

**防滥用**：

- background 令牌桶：**10 req/min**（可配置 1–60）
- 超过限制返回 `RATE_LIMIT` 错误，前端弹 toast「请求过快，请稍候」
- Options 显示当日翻译次数统计 + 配额预警阈值

**权限最小集**：

```json
{
  "permissions": ["storage", "activeTab", "scripting", "contextMenus"],
  "host_permissions": ["https://api.MiniMax.chat/*"]
}
```

不申请 `<all_urls>`。`activeTab` 让 content script 仅在用户主动交互时注入，`scripting` 仅用于用户触发时动态注入（MV3 强制要求显式声明）。

---

## 缓存策略

体验好不好，很大程度取决于「划词到出译文」的延迟。

### 三级缓存

| 层 | 位置 | TTL | 容量 | 延迟 |
|----|------|-----|------|------|
| L1 | 内存（service worker Map） | 5 分钟 | 200 条 | < 5 ms |
| L2 | `chrome.storage.local` | 7 天 | 500 条 | < 50 ms |
| L3 | IndexedDB `beelingoDB` | 不限 | 手动清理 | < 100 ms |

查询顺序：L1 → L2 → L3 → API。任一层命中即返回，并异步回填上层。

### 缓存键

```
key = sha1(原文 + "|" + srcLang + "|" + tgtLang + "|" + provider)
```

`provider` 字段确保切换 Key / Provider 后旧缓存失效。原文做 trim + lowercase 归一化避免「Apple」与「 apple 」双倍存储。

### 失效策略

- 用户在 Options 点「清空缓存」立即清三层
- API Key / Provider / 目标语言变更 → 自动失效该 provider 的全部缓存
- L1 超时即淘汰；L2 超 7 天自动淘汰
- L3 不自动清，提供「生词本导出 + 清空」组合操作

### 隐私边界

- 缓存条目**永不离开本机**
- 「导出生词本」是单向操作（本地 → 文件），文件不会回传到任何服务器

---

## MVP 验收清单

下面是 v0.1.0 发版前必须通过的 10 项：

- [ ] Chrome Web Store 审核通过，Firefox AMO 审核通过
- [ ] 选中文字后 100 ms 内出现悬浮小蜜蜂图标
- [ ] 点击图标或按 `Ctrl+Shift+Y` 触发翻译，结果在 2 秒内显示
- [ ] 译文气泡 5 秒自动消失；`Esc` 或点击页面其他区域也消失
- [ ] 首次安装自动跳转 Options 页引导填 API Key
- [ ] Options 页支持 6+ 语种方向切换（中↔英↔日↔法↔德↔韩）
- [ ] 黑名单域名生效（在黑名单上不渲染图标）
- [ ] 重复选相同文字在缓存命中时 < 100 ms 出结果
- [ ] API Key 错误 / 配额超限 / 网络失败三类错误有清晰提示 + 重试或跳设置
- [ ] `pnpm build:all` 一次性产出 `dist-chrome.zip` + `dist-firefox.zip`

CI 必跑：`pnpm lint && pnpm type-check && pnpm test`，全绿才允许合并。

---

## 开发者贡献指南

### 前置环境

- Node.js ≥ 20
- pnpm ≥ 9（`corepack enable` 启用）
- Chrome / Edge / Firefox 最新稳定版

### 本地启动

```bash
# 1. 克隆仓库
git clone <repo-url> beelingo
cd beelingo

# 2. 安装依赖
pnpm install

# 3. 构建（产物输出到 dist/）
pnpm build              # 当前 __TARGET__ 默认值
pnpm build:chrome       # Chrome 专用
pnpm build:firefox      # Firefox 专用
pnpm build:all          # 两个都出

# 4. 加载到浏览器
# Chrome：chrome://extensions → 开启开发者模式 → 加载已解压的扩展程序 → 选择 dist/chrome/
# Firefox：about:debugging#/runtime/this-firefox → 临时载入附加组件 → 选择 dist/firefox/manifest.json
```

### 开发模式

```bash
pnpm dev          # Vite watch + HMR（仅 Popup / Options 实时刷新）
pnpm test         # Vitest 单元测试
pnpm test:e2e     # Playwright 端到端
pnpm lint         # ESLint + Prettier
pnpm type-check   # tsc --noEmit
```

Content Script 变更需要手动到 `chrome://extensions` 点「重新加载」。

### 提交流程

1. Fork 仓库 → 新建分支 `feat/<short-desc>` 或 `fix/<short-desc>`
2. `pnpm lint && pnpm type-check && pnpm test` 全绿
3. 创建 PR，模板自动展开。请说明：
   - 改动动机（解决什么问题）
   - 是否涉及权限 / manifest 变更
   - UI 改动附截图 / 录屏
4. 等待 CI + 至少一位维护者 Review

### 约定

- 提交信息遵循 **Conventional Commits**（`feat:` / `fix:` / `docs:` / `chore:` 等）
- 新增 Provider 必须在 `docs/api-providers.md` 同步说明
- 涉及 manifest 权限的 PR 必须额外获得一名维护者的 LGTM
- 文件权限：**`src/` 内全部为 `644`**，**不要**给扩展代码 `chmod +x`

---

## 后续路线（M1–M4）

### M1 — MVP（v0.1.0）

核心交付：划词翻译 + Key 自带 + 6 语种 + 双平台首发。

### M2 — 体验增强（v0.2.0）

- 朗读（TTS via Web Speech API）
- 生词本导出（CSV / JSON / Anki）
- 自定义 prompt 模板（让用户控制翻译风格：「学术 / 口语 / 直译 / 意译」）
- 浮窗位置记忆（按选区位置 vs 屏幕中央）

### M3 — 流式与个性化（v0.3.0）

- 流式输出（typing effect）
- 行业术语词典（CS / 医学 / 法律 / 商务，可选加载）
- 多窗口协同（在 A 窗口翻译过的词，B 窗口选中同样文本秒出）
- 翻译历史时间线

### M4 — 跨场景（v0.4.0）

- PDF 阅读器内划词翻译（PDF.js / Chrome PDF Viewer）
- 视频字幕翻译（YouTube / Netflix HTML5 字幕）
- 选中文本右键菜单整合（系统级「在蜂译中翻译」）

---

## 路线图时间表

| 里程碑 | 目标版本 | 大致时间 | 关键事件 |
|--------|---------|---------|---------|
| 项目立项 | — | 已完成 | 命名 + 规划文档 |
| M1 Alpha | v0.1.0-alpha | 立项后 4 周 | MVP 可用；仅作者自测 |
| M1 Beta | v0.1.0-beta | 立项后 6 周 | 开放内测（10–30 人） |
| M1 商店审核 | v0.1.0 | 立项后 8 周 | Chrome Web Store / AMO 提交 |
| M2 | v0.2.0 | v0.1.0 后 4 周 | TTS + 生词本 |
| M3 | v0.3.0 | v0.2.0 后 6 周 | 流式 + 行业词典 |
| M4 | v0.4.0 | v0.3.0 后 8 周 | PDF / 字幕 |

时间表只是粗估，每个里程碑都会根据用户反馈调整。

---

## 隐私声明

**BeeLingo 不收集任何用户数据**。具体承诺：

| 数据类型 | 我们的做法 |
|---------|----------|
| API Key | 只存 `chrome.storage.local`，本机加密，扩展卸载即清除 |
| 翻译历史 | 只在本机 IndexedDB，永不上传 |
| 选中文本 | 只在用户主动触发翻译时才发给用户配置的 API；从不发给我们 |
| 用户身份 | 无账号系统；扩展不识别「你是谁」 |
| 使用统计 | **无**；不内置任何遥测 / analytics / 错误上报 |
| 第三方请求 | 仅用户配置的翻译 Provider 一处，URL 必须在 host_permissions 白名单 |

**用户可控**：

- Options 页有「一键清空所有本地数据」按钮（清 Key、清缓存、清生词本）
- 卸载扩展 = 删除所有 `chrome.storage.local` 数据
- 黑名单域名（Options）让用户完全排除某些站点

---

## FAQ

**Q1：气泡不弹出怎么办？**

排查顺序：

1. 浏览器右上角是否有蜂译图标？ → 没有则扩展未加载
2. 选中文本是否 > 500 字符？ → 太长被过滤
3. 当前站点是否在黑名单？ → Options → 黑名单域名检查
4. 浏览器控制台是否有红色错误？ → 大多是 content script 注入失败
5. 重启浏览器后再试 → 排除 service worker 缓存问题

**Q2：可以免费用吗？**

BeeLingo 本体免费、开源。但翻译 API 本身不免费——你需要在 MiniMax / OpenAI / 其他兼容服务上自购配额。BeeLingo 不收任何费用、不抽成。

**Q3：支持哪些翻译 Provider？**

MVP 默认 MiniMax（M3 / M3.1）。OpenAI 兼容协议意味着理论上任何兼容 `/v1/chat/completions` 的服务都能跑——DeepSeek、月之暗面、智谱 GLM、本地 Ollama（暴露 OpenAI 兼容端口）都算。

**Q4：API Key 会泄露吗？**

不会泄露给我们（我们没服务器），但理论上**网页上的恶意脚本**可以通过 `sendMessage` 触发 background 翻译请求消耗你的配额——这就是为什么我们做了 10 req/min 令牌桶。如果你担心被滥用，Options 里把限流调到 1 req/min。

**Q5：能不能不显示小蜜蜂图标，只用快捷键？**

可以。Options → 触发方式 → 「仅快捷键」。

**Q6：支持 Firefox for Android / Safari 吗？**

不支持。MV3 在 Firefox for Android 上仍处于实验性；Safari 扩展走 App Store 审核且 API 子集不同。后续如果用户量大再考虑。

**Q7：会出网页翻译（整页）吗？**

短期不会。整页翻译会破坏排版、增加内存占用、跟「沉浸式翻译」等成熟产品同质化竞争。BeeLingo 只想做好划词这一件事。

**Q8：能不能团队协作共享 API Key？**

不行。Key 只存在本机 `chrome.storage.local`，不跨设备同步（这是安全设计）。团队建议各自配自己的 Key。

---

## 致谢 / License

**License**: MIT

**致谢**：

- 命名灵感：[mmx（MiniMax-M3.1）](https://platform.minimaxi.com) 协助生成 10+ 候选名
- 工程参考：[Immersive Translate](https://immersivetranslate.com/)、[Saladict](https://github.com/crimx/saladict) 的开放扩展设计
- API：[MiniMax](https://platform.minimaxi.com)、OpenAI、DeepSeek、月之暗面等兼容 OpenAI Chat Completions 协议的服务
- 测试用户：内测组（待 M1 Beta 阶段邀请）

**联系**：

- GitHub Issues：bug & feature request
- Email: beelingo@<your-domain>
- 微信群 / Telegram 群：M1 Beta 阶段建立

---

> *"The limits of my language mean the limits of my world."* — Ludwig Wittgenstein

如果你也觉得「少即是多」，欢迎给个 ⭐ Star，或者直接告诉我们你想看到什么功能。

**Happy buzzing! 🐝**