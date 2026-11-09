// Copies Silero VAD model, worklet and onnxruntime WASM into public/vad/ (served locally, gitignored)
import { cpSync, mkdirSync } from 'node:fs';

const dest = 'public/vad';
const files = [
  'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx',
  'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
  'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
  'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
];

mkdirSync(dest, { recursive: true });
for (const f of files) cpSync(f, `${dest}/${f.split('/').pop()}`);
console.log(`[copy-vad-assets] ${files.length} files -> ${dest}/`);
