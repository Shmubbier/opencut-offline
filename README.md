# OpenCut Offline Desktop

A native, **fully offline** Windows build of the [OpenCut](https://opencut.app) video
editor. No account, no internet, no cloud — install the `.exe`, open it, and edit video
entirely on your machine.

This is a fork of the (archived) **opencut-classic** web editor, repackaged as a desktop
app: the client-side Next.js editor runs inside a native [Tauri](https://tauri.app) shell
(Rust + WebView2), served locally by a bundled Node.js sidecar. Every cloud/network
dependency has been removed so nothing phones home.

## Download / Install

**[⬇ Download OpenCut_0.1.1_x64-setup.exe](https://github.com/Shmubbier/opencut-offline/releases/download/v0.1.1/OpenCut_0.1.1_x64-setup.exe)** (~115 MB) — latest release: **[v0.1.1](https://github.com/Shmubbier/opencut-offline/releases/latest)**. See all [Releases](../../releases), or build it yourself (below).

- Per-user install, **no admin required**. Windows may show a SmartScreen prompt for the unsigned installer — choose *More info → Run anyway*.

Launch **OpenCut** from the Start menu. It opens straight to your projects; create one,
import local media, edit on the timeline, preview, and export — offline.

## What "offline" means here

Compared to upstream, this fork removes or neutralizes every runtime internet call:

| Removed / disabled | Why |
|---|---|
| Accounts & auth | Not needed locally |
| Analytics, BotID | Telemetry |
| Online sound-effects search (Freesound) | Network |
| Feedback endpoint | Network |
| Auto-captions | Formerly downloaded a Whisper model at runtime — now **bundled** and run locally |
| Runtime Google-Fonts fetch | Replaced with a **bundled** curated font set (local `@font-face`) |
| Marketing site, blog, changelog, RSS | Not part of the app |
| Cloudflare / Upstash / Postgres deploy stack | Server infra |

WebView2 is also launched with background-networking disabled. Subtitle **file** import
(`.srt` / `.ass`) and the local font-preview atlas are kept — they work offline.

## Offline features (bundled, no internet)

These run entirely on your machine, with everything shipped inside the installer:

- **Auto-captions** — a bundled Whisper *base* model (via transformers.js) transcribes speech
  offline. The ONNX runtime WASM is bundled too, so nothing is fetched at runtime.
- **Fonts** — ~20 popular font families are self-hosted and render offline when selected. The
  full font picker still previews the whole catalog; non-bundled families fall back to a default.
- **Sound library** — a small pack of built-in sound effects, plus import of your own local
  audio files, both previewable and drag-to-timeline.

(Because the Whisper model is bundled, the installer is ~115 MB.)

## Build from source

Requirements: [Bun](https://bun.sh), [Rust](https://rustup.rs) with the MSVC toolchain,
and the WebView2 runtime (preinstalled on Windows 11).

```bash
bun install
bun run desktop:build
```

The installer lands in `src-tauri/target/release/bundle/nsis/`.
For web-only development: `bun run dev` (the editor at `/projects`).

## Known limitations (roadmap)

- **Font coverage** — only the ~20 bundled families render offline; other families in the
  picker fall back to a default. Bundling more (or a full offline set) is a follow-up.
- **Caption model** — ships the Whisper *base* model (good accuracy for clear speech); larger
  models would be more accurate but much larger to bundle.
- **Imported sounds are session-scoped** — user-imported audio isn't persisted across restarts
  yet (the built-in SFX pack always is).

## AI / Claude attribution

This fork was built with **[Claude Code](https://claude.com/claude-code)** (Anthropic).
Claude planned the work, performed the code changes, set up the Tauri desktop packaging,
and verified the offline build. Commits are co-authored by Claude, and the full
task-by-task record lives in [`docs/superpowers/`](docs/superpowers/). Treat the output as
AI-generated and review it as you would any dependency before relying on it.

## Credits & license

- Original project: **[OpenCut](https://github.com/opencut-app/opencut)** by the OpenCut
  team — this fork is derived from their `opencut-classic` web editor. All credit for the
  editor itself goes to them.
- Licensed under the **MIT License** (see [`LICENSE`](LICENSE)); the original OpenCut
  copyright notice is retained.
