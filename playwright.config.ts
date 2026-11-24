import { defineConfig } from '@playwright/test';

const PORT = 5199;

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    // 仅测试：把响应窗口缩短到 400ms，让整局能快速打完。
    env: { CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true', CLAIM_WINDOW_MS: '400' },
  },
});
