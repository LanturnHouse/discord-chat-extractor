import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': r('./src') } },
  test: {
    environment: 'node',
    // Files that need a DOM opt in with `// @vitest-environment jsdom` at the top.
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    globals: false,
    // jsdom component tests render hundreds of rows; files run in parallel workers, so 5 s is too tight under load.
    testTimeout: 20_000,
    // Vitest stubs every .css import with '' unless told otherwise; the HTML export reads stylesheets via `?raw`.
    css: { include: [/\.css\?raw$/] },
  },
});
