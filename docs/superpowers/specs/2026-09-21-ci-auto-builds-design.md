# CI Auto-Builds — Design Spec

**Date:** 2026-09-21
**Status:** Approved
**Repo:** https://github.com/Shmubbier/opencut-offline

## Goal
Automate building and releasing the OpenCut offline Windows installer via GitHub Actions:
a version tag publishes a GitHub Release with the installer attached; PRs and pushes to
`master` run a build + bundle-completeness check to catch breakage early. Builds must be
reproducible on a clean runner (no reliance on the author's machine state).

## Background (existing build)
`bun run desktop:build` (`scripts/build-desktop.mjs`) already does the whole build:
1. Fetches the Whisper base model (`scripts/fetch-whisper.mjs`) into `public/models/…`
   **only if that directory is absent** (the model is gitignored, ~142 MB).
2. Stages the onnxruntime-web WASM from `node_modules` into `public/ort/`.
3. `next build` → `.next/standalone`, then copies `.next/static` + `public` into it.
4. Stages the standalone tree + a `node.exe` sidecar into `src-tauri/resources`/`binaries`.
5. `tauri build` → NSIS installer at `src-tauri/target/release/bundle/nsis/OpenCut_<ver>_x64-setup.exe`.

The Whisper model + ort wasm + node sidecar are gitignored; CI regenerates them.

## Trigger model
Single workflow `.github/workflows/build.yml` on `windows-latest`:
- **push tag `v*`** → build + smoke test + **publish a GitHub Release** with the installer.
- **pull_request** and **push to `master`** → build + smoke test + **upload the installer as a
  build artifact** (no release).
- `workflow_dispatch` also allowed (manual runs), behaving like the PR/push path.
Concurrency: cancel superseded runs on the same ref. Permissions: `contents: write` (release).

## Job steps (`build` job)
1. `actions/checkout`.
2. `oven-sh/setup-bun` (pin the repo's bun major). Node is preinstalled on the runner;
   `windows-latest` ships Rust (rustup, stable-msvc) + the MSVC toolchain — no separate install.
3. `Swatinem/rust-cache` keyed on `src-tauri` (caches `src-tauri/target` — avoids the ~10-min
   first Rust compile on every run).
4. `actions/cache` for `public/models/onnx-community/whisper-base`, keyed on a manual model
   version string + a hash of `scripts/fetch-whisper.mjs` (so the 142 MB model isn't
   re-downloaded from HF every run; key bump forces a refetch).
5. `bun install`.
6. `bun run desktop:build`.
7. Smoke test: `node scripts/ci-smoke.mjs` (see below). Fails the job on any non-200.
8. Branch:
   - tag `v*`: `softprops/action-gh-release@v2` with `src-tauri/target/release/bundle/nsis/*.exe`,
     `GITHUB_TOKEN`, release name/body from the tag (and its annotation/notes).
   - otherwise: `actions/upload-artifact` with the installer.

## Smoke test — `scripts/ci-smoke.mjs`
Node ESM, runnable locally too. Starts `.next/standalone/server.js` on a free/fixed port
(`PORT`, `HOSTNAME=127.0.0.1`), waits for `/api/health`, then HEAD/GETs each required URL and
asserts HTTP 200, then kills the server. Non-200 (or spawn failure) → non-zero exit.
Endpoints checked:
- `/api/health`, `/projects`, `/editor/smoke-test`
- `/fonts/local/manifest.json`
- `/sfx/manifest.json`
- `/ort/ort-wasm-simd-threaded.jsep.wasm`
- `/models/onnx-community/whisper-base/config.json`
- `/models/onnx-community/whisper-base/tokenizer.json`
- `/models/onnx-community/whisper-base/onnx/encoder_model_q4.onnx`

This proves the bundle is **complete and served** — it does NOT run the editor/captions in a
browser, so it does not catch runtime worker bugs (see Limitations).

## Build-reliability hardening (folded in — CI depends on it)
1. **`scripts/fetch-whisper.mjs`: validate completeness, not just presence.** Replace the
   `existsSync && size > 0` skip with a size check against the remote `Content-Length` (HEAD
   request); re-download when the local size differs (or is 0). Prevents a truncated/partial
   download (plausible for a 142 MB file, and cached across CI runs) from being treated as
   complete and silently shipping a broken model.
2. **`scripts/build-desktop.mjs`: always run `fetch-whisper`.** Change step 0 from "run only if
   the model dir is absent" to always invoke `fetch-whisper.mjs` (which is idempotent and now
   completeness-checked), so a partially-restored model cache self-heals rather than being
   skipped. (fetch-whisper still no-ops when every file is present and correctly sized.)

## Tag/version guard
On the tag path, a step asserts the pushed tag (`v0.1.2`) matches `"version"` in
`src-tauri/tauri.conf.json` (`0.1.2`), failing early on mismatch so the release artifact name
always matches the tag.

## Files
- Create `.github/workflows/build.yml`
- Create `scripts/ci-smoke.mjs`
- Modify `scripts/fetch-whisper.mjs` (completeness check)
- Modify `scripts/build-desktop.mjs` (always invoke fetch-whisper)

## Success criteria
- Opening a PR runs the workflow, builds the installer, passes the smoke test, and uploads the
  installer artifact — with no red steps.
- Pushing tag `vX.Y.Z` (matching tauri.conf version) publishes a GitHub Release with
  `OpenCut_X.Y.Z_x64-setup.exe` attached, gated behind a passing smoke test.
- A deliberately broken bundle (e.g. a missing model file) fails the smoke test and blocks
  the release.

## Limitations / non-goals
- The smoke test checks bundle completeness + serving, NOT in-browser editor/caption behavior.
  A headless-browser E2E (which could catch runtime worker bugs like the blob-worker path issue)
  is a deferred follow-up.
- Windows x64 only (matches the app). Cross-platform CI is a separate future project.
- No code signing here — the published installer is still unsigned (SmartScreen warning remains);
  signing is its own queued sub-project.

## Risks & mitigations
- **HF download rate limits / flakiness** → model cache + completeness-checked refetch; job fails
  loudly with the HTTP status on a hard failure.
- **First-run Rust compile time (~10-15 min)** → `rust-cache` makes subsequent runs fast.
- **Runner toolchain drift** (if `windows-latest` ever drops preinstalled Rust/MSVC) → add an
  explicit `dtolnay/rust-toolchain` step; noted as a fallback in the plan.
