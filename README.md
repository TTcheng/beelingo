# BeeLingo · 蜂译

> 选中即译，蜂速可达 — 你的划词，你的 Key，你的隐私。

浏览器划词翻译扩展，Chrome MV3 + Firefox MV3 双平台首发，用户自带 OpenAI 兼容协议 API Key（默认指向 MiniMax）。

## 仓库结构

```
beelingo/
├── package.json
├── tsconfig.json
├── vite.config.ts / vite.config.chrome.ts / vite.config.firefox.ts
├── scripts/
├── public/
│   ├── icons/         # 16/32/48/96/128 PNG
│   └── _locales/      # i18n: en, zh_CN
└── src/
    ├── content/       # 划词监听 + 悬浮图标 + 译文气泡 (Shadow DOM)
    ├── background/    # service worker，路由消息、唯一持有 API Key
    ├── popup/         # 工具栏弹窗：开关 + 最近翻译
    ├── options/       # API Key、模型、语种、快捷键配置
    ├── shared/
    │   ├── translate/ # API 客户端、prompt 模板、响应解析、语种常量
    │   ├── storage/   # storage key 常量 + zod schema
    │   ├── messaging/ # content↔bg 消息协议（type 枚举）
    │   ├── i18n/      # chrome.i18n 包装
    │   ├── hotkey/    # 默认快捷键常量
    │   └── utils/
    └── types/
```

## 一句话定位

选中即译 — 划词后小蜜蜂按钮或快捷键翻译，5 秒气泡展示译文。

## 技术栈

- MV3 + 原生 JS + Vite + TypeScript（strict）
- 一个仓库出 Chrome + Firefox 双产物
- 通过 `__TARGET__` 编译宏 + 多 manifest 切换

## 双平台差异点

| 维度 | Chrome MV3 | Firefox MV3 | 处理 |
|------|-----------|-------------|------|
| Service Worker 生命周期 | 30s 冷启动 | 同 | 状态进 `chrome.storage.session` |
| Mac 快捷键修饰符 | 默认 Ctrl | 需 `mac_ctrl` | manifest 区分声明 |
| `browser_specific_settings` | 不要 | **必需**（AMO 要求） | `manifest.firefox.json` 注入 |
| 后台脚本 | 仅 `service_worker` | 也支持 `scripts` 数组 | MVP 只用 service_worker |

## 划词流程

```
选中文字
  → mouseup / selectionchange 监听（content script）
  → 在选区右上角渲染小蜜蜂图标（Shadow DOM）
  → 点击图标 / 按快捷键 Ctrl+Shift+Y
  → chrome.runtime.sendMessage({type: 'TRANSLATE_REQUEST', text})
  → background 持有 API Key → 调 OpenAI 兼容 /chat/completions
  → 标准化为 TranslationResult 返回
  → content script 在选区附近渲染气泡，5s 自动收
```

## 核心 API Key 安全设计

1. **Key 只存 background**：content script 永远拿不到
2. **chrome.storage.local** 加密级别等同于 localStorage，但**不进 chrome.storage.sync**（避免跨设备同步泄露）
3. **host_permissions 限定白名单**：默认 `https://api.MiniMax.chat/*`，用户可改但不允许通配符
4. **background 内置令牌桶限流**：默认 10 req/min，防止被脚本注入刷量
5. **options 页面明文显示前要求二次确认**：点 "显示" 才显示，10s 后自动隐藏

## 缓存三级

| 层 | 位置 | TTL | 容量 |
|----|------|-----|------|
| L1 | 内存（service worker Map） | 5 分钟 | 200 条 |
| L2 | `chrome.storage.local` | 7 天 | 500 条 |
| L3 | IndexedDB (`beelingoDB`) | 不限 | 手动清理 |

查询顺序 L1 → L2 → L3 → API；任意一层命中即返回并回填上层。

## MVP 验收清单

- [ ] Chrome 商店审核通过，Firefox AMO 审核通过
- [ ] 选中文字后 100ms 内出现悬浮小蜜蜂图标
- [ ] 点击图标或按 Ctrl+Shift+Y 触发翻译，结果在 2 秒内显示
- [ ] 译文气泡 5 秒自动消失，点击外部或 Esc 也消失
- [ ] 首次安装自动跳转 Options 页引导填 API Key
- [ ] Options 页支持 6+ 语种方向切换（中↔英↔日↔法↔德↔韩）
- [ ] 黑名单域名生效（在黑名单上不渲染图标）
- [ ] 重复选相同文字在缓存命中时 < 100ms 出结果
- [ ] API Key 错误/配额超限/网络失败三类错误有清晰提示 + 重试/跳设置
- [ ] `npm run build:all` 一次性产出 dist-chrome.zip + dist-firefox.zip

## 后续阶段

1. **M1（MVP）**：划词翻译 + Key 自带 + 6 语种
2. **M2**：朗读（TTS Web Speech）、收藏夹、生词本
3. **M3**：流式输出（typing effect）、自定义 prompt、行业术语词典
4. **M4**：网页 PDF 翻译、视频字幕翻译

---

## 规划来源

本规划由 mmx（MiniMax-M3.1）协助起草；项目代码尚未开始，待人工确认后再迭代。