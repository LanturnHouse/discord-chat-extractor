import { build, defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const alias = { '@': r('./src') };

// The MV3 service worker is built in its own pass instead of as a second entry of the app build: with two entries,
// every module they share (e.g. src/shared/constants.ts) is hoisted into a hashed `assets/*.js` chunk that
// `background.js` would then import. A standalone, un-hashed, single-file worker is easier to reason about and verify.
function backgroundWorker(): Plugin {
  return {
    name: 'dce:background-worker',
    apply: 'build',
    async writeBundle() {
      await build({
        configFile: false,
        resolve: { alias },
        build: {
          outDir: 'dist',
          emptyOutDir: false, // the app build already emptied dist/ and wrote into it
          copyPublicDir: false,
          target: 'es2022',
          sourcemap: false,
          lib: { entry: r('./src/background/index.ts'), formats: ['es'], fileName: () => 'background.js' },
        },
      });
    },
  };
}

// dist/ layout (loadable via chrome://extensions -> "Load unpacked"):
//   app.html + assets/*   the web app that opens in a normal tab (chrome-extension://<id>/app.html)
//   background.js         the service worker (see plugin above)
//   manifest.json, icons/ copied as-is from public/
export default defineConfig({
  plugins: [react(), backgroundWorker()],
  resolve: { alias },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      input: { app: r('./app.html') },
    },
  },
  server: { port: 5173, open: false },
});
