import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const publicRoot = path.join(desktopRoot, "public", "runtime");

const copies = [
  {
    from: path.join(
      desktopRoot,
      "node_modules",
      "@ricky0123",
      "vad-web",
      "dist",
      "silero_vad_legacy.onnx",
    ),
    to: path.join(publicRoot, "vad", "silero_vad_legacy.onnx"),
  },
  {
    from: path.join(
      desktopRoot,
      "node_modules",
      "@ricky0123",
      "vad-web",
      "dist",
      "silero_vad_v5.onnx",
    ),
    to: path.join(publicRoot, "vad", "silero_vad_v5.onnx"),
  },
  {
    from: path.join(
      desktopRoot,
      "node_modules",
      "@ricky0123",
      "vad-web",
      "dist",
      "vad.worklet.bundle.min.js",
    ),
    to: path.join(publicRoot, "vad", "vad.worklet.bundle.min.js"),
  },
];

const onnxDistDir = path.join(
  desktopRoot,
  "node_modules",
  "onnxruntime-web",
  "dist",
);
const onnxRuntimeCopies = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jspi.mjs",
  "ort-wasm-simd-threaded.jspi.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];

for (const filename of onnxRuntimeCopies) {
  copies.push({
    from: path.join(onnxDistDir, filename),
    to: path.join(publicRoot, "onnx", filename),
  });
}

for (const { from, to } of copies) {
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { force: true });
}

const live2dRuntimeDir = path.join(publicRoot, "live2d");
mkdirSync(live2dRuntimeDir, { recursive: true });
writeFileSync(
  path.join(live2dRuntimeDir, "README.txt"),
  [
    "Optional Live2D Cubism Core runtime files live here.",
    "To enable the vendored Live2D renderer, place live2dcubismcore.min.js in this folder.",
    "The desktop shell will fall back gracefully when the core runtime is not present.",
  ].join("\n"),
  "utf-8",
);

console.log("Embodiment runtime assets synced.");
