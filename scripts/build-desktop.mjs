#!/usr/bin/env node
// One-command desktop build: next build -> assemble static/public into the
// standalone server -> stage node sidecar + resources for Tauri -> tauri build.
// Fails loudly (non-zero exit) on the first error via execSync's default throw.

import { execSync } from "node:child_process";
import { existsSync, rmSync, cpSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const bun = process.env.BUN
  ?? "/c/Users/naomi/AppData/Local/Microsoft/WinGet/Packages/Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe/bun-windows-x64/bun.exe"
  ?? "bun";

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
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
