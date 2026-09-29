import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, cpSync } from 'node:fs';

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
      closeBundle() {
        copyStatic('firefox');
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
      // Firefox 115 临时加载：background 单独用 esbuild 打成 IIFE（manifest
      // 走 background.scripts，不支持 ES module）。其余入口继续走 Vite ESM。
      // 见 scripts/build-firefox-background.mjs。
      input: {
        content: resolve(root, 'content/index.ts'),
        options: resolve(root, 'options.html'),
        popup: resolve(root, 'popup.html'),
      },
      output: {
        entryFileNames: 'chunks/[name]-[hash].js',
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