# OpenCut Offline — Limitations / Follow-ups Implementation Plan (Part 2)

> **For agentic workers:** executed via superpowers:subagent-driven-development, fresh subagent per task + review.

**Goal:** Address the deferred limitations from Part 1: dead-code cleanup, graceful startup errors, force-kill orphan guard, bundled curated fonts (offline), a local sound library (folder import + bundled SFX pack), and offline auto-captions via a bundled Whisper base model.

**Architecture:** Same app — Next.js editor in a Tauri v2 shell with a bundled Node sidecar. Fonts/model/SFX are staged into the app as bundled assets (public/ for web-served assets, downloaded/generated at build where large). Runtime stays fully offline.

**Tech Stack:** Next.js 16, Tauri v2 (Rust), Bun, `@huggingface/transformers` (transformers.js, local-model mode) for Whisper, self-hosted woff2 fonts.

**Spec:** decisions captured in chat 2026-09-21 — Whisper base (~145MB), curated font set (~15-25), sounds = local folder import + bundled CC0 SFX pack.

## Global Constraints
- No new RUNTIME internet calls. Build-time downloads (fonts, Whisper model) are fine; the shipped app must work offline.
- Large bundled assets (Whisper model ~145MB, fonts) are gitignored and produced/staged by the build script or a documented fetch step — NOT committed to git. Bundled SFX (small, self-generated CC0) MAY be committed.
- Keep `output: "standalone"`, the sidecar architecture, and the WebView2 offline flags intact.
- Bun full path: `/c/Users/naomi/AppData/Local/Microsoft/WinGet/Packages/Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe/bun-windows-x64/bun.exe`. gh at `C:\Program Files\GitHub CLI\gh.exe`.
- Commit after each task; push to origin/master at the end (or per task).

## Tasks

### Task A: Dead-code cleanup
Remove now-unused code left from Part 1's stripping:
- `src/sounds/use-sound-search.ts` (no importers) — delete (NOTE: Task F may re-introduce a local search; if so, coordinate — but per plan order A runs first, F builds fresh).
- Unused `FREESOUND_CLIENT_ID` / `FREESOUND_API_KEY` in `src/env/web.ts`.
- Orphaned transcription helpers in `src/transcription/*` that nothing imports AND that Task E won't need (verify against Task E's needs first — some may be reused; if E needs them, SKIP those).
- `src/site/external-tools.ts` (databuddy link, no importers) and `src/blog/query.ts` (remote fetch, no importers) if confirmed unused.
Verify with grep (no importers) before each deletion; `tsc` count must not increase (baseline 12). Commit.

### Task B: Graceful startup errors (Rust)
In `src-tauri/src/lib.rs`, replace `.expect(...)` panics on the core start path (resolve_server_js, pick_free_port, sidecar spawn) with error handling that navigates the main window to a clear in-app "Failed to start OpenCut: <reason>" message (reuse the health-timeout failure UI path) instead of hard-crashing. `cargo check` + a unit-testable error path if practical. Commit.

### Task C: Force-kill orphan guard (Win32 Job Object)
Ensure the Node sidecar dies with the app even on forced kill. On Windows, create a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and assign the sidecar child process to it, so when the app process dies the OS terminates the child. Implement in `src-tauri/src/lib.rs` (use the `windows` crate or `winapi`). Keep the existing graceful-exit kill too. Verify: `cargo check`; document the mechanism. Commit. (ponytail: Windows-only Job Object; note the ceiling.)

### Task D: Bundle curated fonts (offline)
- Pick ~20 popular Google font families. Add a build step (`scripts/fetch-fonts.mjs` or fold into build-desktop) that downloads their woff2 files into `public/fonts/families/<family>/` and generates `@font-face` CSS (build-time internet OK). Gitignore the downloaded woff2 (or commit if small enough — a curated set of ~20 families' core weights is a few MB and MAY be committed for reproducibility; prefer committing to keep offline builds simple).
- Rewrite `src/fonts/google-fonts.ts` `loadFullFont` to load the LOCAL @font-face for bundled families (no googleapis). The font picker should reflect which families are actually bundled/available.
- Verify: no `fonts.googleapis` reference; a bundled non-system font renders. Commit.

### Task E: Offline auto-captions (bundled Whisper base)
- Re-add `@huggingface/transformers` (transformers.js). Configure it for LOCAL-ONLY models: `env.allowRemoteModels = false`, `env.localModelPath` pointing at the bundled model dir.
- Add a build step (`scripts/fetch-whisper.mjs`) that downloads the `Xenova/whisper-base` ONNX model + tokenizer/config into `public/models/whisper-base/` (build-time; ~145MB). Gitignore the model files; the build script fetches them if absent.
- Restore `src/services/transcription/worker.ts` to run transcription with transformers.js against the local model; un-stub `service.ts`. Re-enable the auto-caption UI trigger in `src/subtitles/components/assets-view.tsx` (was replaced with an offline notice) — wire it back to the (now offline) service.
- Ensure the model files are staged into the Tauri resources by `build-desktop.mjs` (they're served by the Next standalone server as `public/`, so copying public into standalone already covers it — verify the model is reachable at its URL offline).
- Verify: with no internet, generating captions on a clip with speech produces text. Commit. (This is the hardest task — if transformers.js/ONNX-in-WebView2 hits a wall, report BLOCKED with specifics.)

### Task F: Local sound library (folder import + bundled SFX pack)
- Generate a small CC0 SFX pack (self-synthesized WAVs — e.g. click, pop, whoosh, beep, transition — created by a `scripts/gen-sfx.mjs` using raw PCM/WAV writing; these are original/public-domain, safe to commit) into `public/sfx/` with a manifest.
- Add a "local sound library" UI in `src/sounds/components/assets-view.tsx`: (a) list + preview + add-to-timeline for the bundled SFX pack; (b) a "Add folder"/"Add files" control (file input `accept="audio/*"` multiple, or File System Access API) to import the user's own audio into the local library (store handles/blobs like other imported media). Replace the "unavailable offline" notice.
- Verify: bundled SFX play + add to timeline; importing a local audio file works — offline. Commit.

### Task G: Rebuild + verify offline; push
- Run `bun run desktop:build`; confirm the installer builds with the new assets (note new size ~180MB+).
- Offline re-verify (loopback-only) that captions, fonts, and sounds work in the installed app.
- Push all commits to origin/master. Report final installer size + a summary.

## Notes
- Order: A, B, C (clear wins) → D, F (medium) → E (hard) → G (rebuild/verify/push).
- Each task: fresh subagent, per-task brief, review, ledger entry (SDD).
