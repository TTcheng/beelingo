import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    // 默认 node 环境；DOM 相关测试用 per-file `// @vitest-environment jsdom`
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        // background/popup/options/content/index.ts 依赖完整 chrome.* runtime
        // 与 Shadow DOM 副作用，已经被单元覆盖在更低层（rate-limit、storage、bubble）
        'src/background/index.ts',
        'src/popup/index.ts',
        'src/options/index.ts',
        'src/content/index.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});