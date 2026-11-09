import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // entries: scan only our app, not HTML inside server/rvc_env (gradio) — ORT loads its WASM glue (.mjs) at runtime from public/vad; pre-bundling breaks that lookup
  optimizeDeps: { entries: ['index.html'], exclude: ['onnxruntime-web'] },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    warmup: {
      clientFiles: ['./src/main.tsx', './src/App.tsx', './src/index.css'],
    },
  },
});
