#!/usr/bin/env node
// One-command desktop build: next build -> assemble static/public into the
// standalone server -> stage node sidecar + resources for Tauri -> tauri build.
// Fails loudly (non-zero exit) on the first error via execSync's default throw.

import { execSync } from "node:child_process";
import {
  existsSync,
  rmSync,
  cpSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
// Rely on PATH by default (portable across machines/CI). Set $BUN to override
// with an absolute path if `bun` isn't on PATH in a given shell — it must be a
// native Windows path (e.g. C:\...\bun.exe), not an msys-style /c/... path,
// since this gets executed via cmd.exe.
const bun = process.env.BUN ?? "bun";

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

// 0. Stage the offline auto-captions assets into public/ BEFORE next build, so
// they get copied into .next/standalone/public and served locally by the sidecar
// (no runtime network). The Whisper model is large + gitignored, so fetch it if
// absent; the ort wasm comes from node_modules (version-correct) each build.
const whisperDir = join(
  root,
  "public",
  "models",
  "onnx-community",
  "whisper-base",
);
if (!existsSync(whisperDir)) {
  run(`"${process.execPath}" scripts/fetch-whisper.mjs`);
}

const ortSrc = join(root, "node_modules", "onnxruntime-web", "dist");
const ortDest = join(root, "public", "ort");
mkdirSync(ortDest, { recursive: true });
for (const f of readdirSync(ortSrc)) {
  // The wasm runtime + its JS glue that transformers.js loads from wasmPaths.
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(f)) {
    copyFileSync(join(ortSrc, f), join(ortDest, f));
  }
}

// 1. Build Next.js (produces .next/standalone + .next/static)
run(`"${bun}" run build`);

const nextDir = join(root, ".next");
const standaloneDir = join(nextDir, "standalone");

// 2. Static assets aren't included in the standalone output by default.
cpSync(join(nextDir, "static"), join(standaloneDir, ".next", "static"), {
  recursive: true,
  force: true,
});

// 3. Nor is /public.
cpSync(join(root, "public"), join(standaloneDir, "public"), {
  recursive: true,
  force: true,
});

// 4. Stage the whole standalone server tree as a Tauri resource.
const resourceServerDir = join(root, "src-tauri", "resources", "server");
rmSync(resourceServerDir, { recursive: true, force: true });
cpSync(standaloneDir, resourceServerDir, { recursive: true, force: true });

// 5. Stage the node sidecar. Tauri's externalBin expects a target-triple
// suffixed name.
// ponytail: hardcoded to the Windows x64 MSVC triple — this pipeline is
// Windows-only for v1. Add per-platform triples (rustc -vV) if/when macOS or
// Linux builds are needed.
const sidecarPath = join(
  root,
  "src-tauri",
  "binaries",
  "node-x86_64-pc-windows-msvc.exe",
);
if (!existsSync(sidecarPath)) {
  copyFileSync(process.execPath, sidecarPath);
}

// 6. Build the Tauri app (produces the NSIS installer).
run(`"${bun}" run tauri build`);

console.log("\nDesktop build complete.");
