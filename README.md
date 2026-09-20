# OpenCut Offline Desktop

A native, **fully offline** Windows build of the [OpenCut](https://opencut.app) video
editor. No account, no internet, no cloud — install the `.exe`, open it, and edit video
entirely on your machine.

This is a fork of the (archived) **opencut-classic** web editor, repackaged as a desktop
app: the client-side Next.js editor runs inside a native [Tauri](https://tauri.app) shell
(Rust + WebView2), served locally by a bundled Node.js sidecar. Every cloud/network
dependency has been removed so nothing phones home.

## Download / Install

Grab the installer from the [Releases](../../releases) page (or build it yourself, below):

- `OpenCut_x.y.z_x64-setup.exe` — per-user install, **no admin required**.

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
| Auto-captions (Whisper via HuggingFace) | Downloads a model at runtime |
| Runtime Google-Fonts fetch | Network (local font atlas kept) |
| Marketing site, blog, changelog, RSS | Not part of the app |
| Cloudflare / Upstash / Postgres deploy stack | Server infra |

WebView2 is also launched with background-networking disabled. Subtitle **file** import
(`.srt` / `.ass`) and the local font-preview atlas are kept — they work offline.

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

- **Auto-captions** are disabled (re-enabling needs a bundled Whisper model).
- **Non-system fonts** fall back to a default until real font files are bundled.
- **No online sound library** (local import still works).
- Force-killing the app (Task Manager) can leave the Node sidecar running; closing the
  window normally shuts it down cleanly.

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
