import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // Bundle the engine's TS source into the main/host chunks; keep native deps external.
    plugins: [externalizeDepsPlugin({ exclude: ['@edhelper/engine'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'engine-host': resolve(__dirname, 'src/host/engine-host.ts'),
        },
        // The engine barrel re-exports better-sqlite3/zeromq modules the app
        // never uses. Without this, Rollup keeps bare side-effect requires of
        // those externals in out/main/index.js — fatal in a packaged app that
        // ships no node_modules. Verified: with this line the bundle contains
        // zero references to better-sqlite3/zeromq/bindings.
        treeshake: { moduleSideEffects: 'no-external' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
  },
});
