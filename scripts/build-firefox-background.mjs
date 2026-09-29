/**
 * Firefox 临时加载专用：把 background/index.ts + 依赖打成单个 IIFE，
 * 写入 dist/firefox/background.js。
 *
 * 为什么需要这一步：
 *   - manifest V3 在 Firefox 115 临时加载只接受 background.scripts（不支持
 *     service_worker）。
 *   - background.scripts 不接受 ES module（不能有 import/export）。
 *   - Vite 默认输出 ESM，无法满足要求。
 *   - esbuild 直接把 TS + zod + shared 全 inline 成单个 IIFE 文件。
 *
 * 正式发布到 AMO 后，Firefox 121+ 支持 background.service_worker，
 * 届时可以删掉这个脚本，回到 Chrome/Firefox 共用 Vite 配置。
 */

import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

await build({
  entryPoints: [resolve(root, 'src/background/index.ts')],
  outfile: resolve(root, 'dist/firefox/background.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  sourcemap: true,
  // 在 IIFE 内部把 chrome.* 引用都解析为 runtime call；
  // Firefox 临时加载走 background.scripts 时 chrome.* 也可用
  define: {
    __TARGET__: JSON.stringify('firefox'),
  },
  logLevel: 'info',
});

console.log('[firefox] background.js (IIFE) written to dist/firefox/background.js');