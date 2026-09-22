#!/usr/bin/env node
// Boots the built Next.js standalone server and asserts every bundled offline
// asset serves HTTP 200 — proving the bundle is complete before publishing.
// Exits non-zero on any failure. Does NOT exercise the editor in a browser.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const standaloneDir = join(root, ".next", "standalone");
const serverJs = join(standaloneDir, "server.js");
if (!existsSync(serverJs)) {
  console.error(`missing ${serverJs} — run \`bun run desktop:build\` first`);
  process.exit(1);
}

const PORT = process.env.SMOKE_PORT ?? "3399";
const base = `http://127.0.0.1:${PORT}`;
const PATHS = [
  "/api/health",
  "/projects",
  "/editor/smoke-test",
  "/fonts/local/manifest.json",
  "/sfx/manifest.json",
  "/ort/ort-wasm-simd-threaded.jsep.wasm",
  "/models/onnx-community/whisper-base/config.json",
  "/models/onnx-community/whisper-base/tokenizer.json",
  "/models/onnx-community/whisper-base/onnx/encoder_model_q4.onnx",
  "/models/onnx-community/whisper-small/config.json",
  "/models/onnx-community/whisper-small/tokenizer.json",
  "/models/onnx-community/whisper-small/onnx/encoder_model_q4.onnx",
];

const child = spawn(process.execPath, [serverJs], {
  cwd: standaloneDir,
  env: { ...process.env, PORT, HOSTNAME: "127.0.0.1" },
  stdio: "inherit",
});

async function status(path) {
  // Prefer HEAD; some handlers 405 HEAD, so fall back to GET.
  for (const method of ["HEAD", "GET"]) {
    try {
      const r = await fetch(`${base}${path}`, { method });
      if (r.status !== 405) return r.status;
    } catch {
      /* retry with GET, then report -1 below */
    }
  }
  return -1;
}

let failed = false;
try {
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline)
      throw new Error("server did not become healthy within 30s");
    await new Promise((r) => setTimeout(r, 500));
  }
  for (const p of PATHS) {
    const s = await status(p);
    const ok = s === 200;
    console.log(`${ok ? "PASS" : "FAIL"} ${String(s).padStart(3)}  ${p}`);
    if (!ok) failed = true;
  }
} catch (e) {
  console.error(`smoke test error: ${e.message}`);
  failed = true;
} finally {
  child.kill();
}
process.exit(failed ? 1 : 0);
