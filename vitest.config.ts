import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', include: ['tests/shared/**/*.test.ts'], environment: 'node' } },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './tests/worker/wrangler.test.jsonc' } })],
        test: { name: 'worker', include: ['tests/worker/**/*.test.ts'] },
      },
    ],
  },
});
