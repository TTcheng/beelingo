import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, cpSync } from 'node:fs';
import { buildContent } from './scripts/build-content.mjs';

const root = resolve(__dirname, 'src');
const outDir = resolve(__dirname, 'dist/firefox');

/** build 完成后拷贝静态资源到 dist */
function copyStatic(target: 'chrome' | 'firefox') {
  const manifestSrc = resolve(__dirname, `src/manifest.${target}.json`);
  const manifestDst = resolve(__dirname, `dist/${target}/manifest.json`);
  copyFileSync(manifestSrc, manifestDst);
  cpSync(resolve(__dirname, 'src/icons'), resolve(__dirname, `dist/${target}/icons`), {
    recursive: true,
  });
  cpSync(
    resolve(__dirname, 'public/_locales'),
    resolve(__dirname, `dist/${target}/_locales`),
    { recursive: true },
  );
}

export default defineConfig({
  root,
  define: {
    __TARGET__: JSON.stringify('firefox'),
  },
  plugins: [
    {
      name: 'beelingo-copy-static',
      async closeBundle() {
        copyStatic('firefox');
        // content 入口不走 Vite：MV3 content_scripts 是经典脚本，ESM 会报
        // "Cannot use import statement outside a module"。单独打成 IIFE。
        await buildContent('firefox');
      },
    },
  ],
  build: {
    outDir,
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      // Firefox 115 临时加载：background / content 各自用 esbuild 打成 IIFE
      // （manifest 走 background.scripts、content_scripts.js 不支持 ES module，
      // 且 chrome.scripting.executeScript 的 files 不能带 import）。
      // Vite 这里只负责 options/popup 两个 HTML 入口 + 共享模块的 chunk 目录。
      // content 由 scripts/build-content.mjs 打成 IIFE，见 closeBundle；
      // background 由 scripts/build-firefox-background.mjs 单独打包。
      input: {
        options: resolve(root, 'options.html'),
        popup: resolve(root, 'popup.html'),
      },
      output: {
        // 入口文件名必须与 manifest.firefox.json 中的 content_scripts.js /
        // popup/options.html 重写后的 script src 保持一致。Firefox 临时加载走
        // manifest V3 的 background.scripts（不支持 service_worker），background
        // 由 scripts/build-firefox-background.mjs 单独打包成 IIFE，这里不放进
        // Vite 的入口里，避免 Vite 顺手覆盖 dist/firefox/background.js。
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (info) =>
          info.name === 'style.css' ? '[name][extname]' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  resolve: {
    alias: {
      '@': root,
    },
  },
});