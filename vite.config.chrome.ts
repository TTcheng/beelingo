import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, cpSync } from 'node:fs';
import { buildContent } from './scripts/build-content.mjs';

const root = resolve(__dirname, 'src');
const outDir = resolve(__dirname, 'dist/chrome');

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
    __TARGET__: JSON.stringify('chrome'),
  },
  plugins: [
    {
      name: 'beelingo-copy-static',
      async closeBundle() {
        copyStatic('chrome');
        // content 入口不走 Vite：MV3 content_scripts 是经典脚本，ESM 会报
        // "Cannot use import statement outside a module"。单独打成 IIFE。
        await buildContent('chrome');
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
      // content 由 scripts/build-content.mjs 打成 IIFE，见 closeBundle。
      input: {
        background: resolve(root, 'background/index.ts'),
        options: resolve(root, 'options.html'),
        popup: resolve(root, 'popup.html'),
      },
      output: {
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