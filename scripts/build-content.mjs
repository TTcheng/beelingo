/**
 * 把 src/content/index.ts（+ 依赖 + Shadow DOM 样式）打成单个经典脚本 IIFE，
 * 写入 dist/<target>/content.js。
 *
 * 为什么不能用 Vite 输出的 ESM：
 *   - MV3 content_scripts（Chrome 全平台、Firefox 临时加载）一律按经典脚本
 *     执行，静态 import 会立刻抛
 *     `Uncaught SyntaxError: Cannot use import statement outside a module`。
 *   - chrome.scripting.executeScript 的 `files` 字段同样只接受经典脚本。
 *   - esbuild 把 TS + 共享模块 + 样式文本全部 inline 成单个 IIFE 满足要求。
 *
 * 由 vite.config.<target>.ts 的 closeBundle 调用，因此 `vite build` 与
 * `vite build --watch` 都会在每次构建后重新生成 content.js。
 *
 * 正式发布（Firefox 121+ / Chrome）后若放弃经典脚本兼容，可删掉本脚本，
 * 回到让 Vite 直接输出 content 入口的 ESM 方案。
 */
import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

/**
 * @param {'chrome' | 'firefox'} target
 */
export async function buildContent(target) {
  await build({
    entryPoints: [resolve(root, 'src/content/index.ts')],
    outfile: resolve(root, `dist/${target}/content.js`),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
    // bubble.ts 通过 `import cssText from './style.css?inline'` 取样式文本，
    // 再塞进 shadow DOM。esbuild 默认把 .css 当独立样式表（无 default 导出），
    // 会令 cssText 变成 undefined 并另外输出 content.css。改成 text loader 后
    // 默认导出即文件内容，行为与 Vite 的 `?inline` 一致。
    loader: { '.css': 'text' },
    // content 脚本里只用了 chrome.runtime.*，Firefox / Chrome 都支持。
    define: { __TARGET__: JSON.stringify(target) },
    logLevel: 'info',
  });
  console.log(`[${target}] content.js (IIFE) written to dist/${target}/content.js`);
}
