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
      input: {
        background: resolve(root, 'background/index.ts'),
        content: resolve(root, 'content/index.ts'),
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