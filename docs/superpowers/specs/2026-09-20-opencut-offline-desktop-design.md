# OpenCut Offline Desktop — Design Spec

**Date:** 2026-09-20
**Status:** Approved (approach B)

## Goal

Fork the (archived) `opencut-classic` Next.js video editor and ship it as a
native Windows `.exe` that runs fully offline — no internet needed to launch
or to edit/export video.

## Why this is feasible

The editor is already client-side:

- `src/app/editor/[project_id]/page.tsx` is `"use client"`; it reads the id
  client-side and loads projects from IndexedDB (a 25-version storage
  migration chain lives in `src/services/storage/migrations/`).
- Media engine is `opencut-wasm` (their Rust core, published npm package
  `^0.2.10`) + `mediabunny` — all in-browser.
- No COOP/COEP headers anywhere in the repo, so the wasm path does **not**
  require SharedArrayBuffer / cross-origin isolation. Nothing special needed
  for the webview.
- `apps/web` has **no** `workspace:` / `@opencut/*` deps — it is
  self-contained and can be lifted out of the monorepo as the project root.

The only reason it "needs internet" is that it's served from a web server and
has a handful of cloud/analytics/remote-asset calls. Bundle the assets locally
and neutralize those calls → offline.

## Packaging approach (B): Tauri + Next standalone server sidecar

- Keep the Next.js app essentially intact with `output: "standalone"`.
- `next build` produces `.next/standalone/server.js` (plain Node server).
- A Tauri v2 shell bundles a portable `node.exe` + the standalone build as
  resources, spawns `node server.js` on a free localhost port, health-checks
  it, then opens a WebView2 window at `http://127.0.0.1:<port>`.
- WebView2 (Chromium-based, present by default on Win11) gives the modern
  browser environment the editor needs (IndexedDB, OPFS, wasm, workers).

Result: small installer (~80 MB), modern webview, minimal code changes to the
app, and future upstream changes are easy to pull because the app is unmodified
except for the strip list below.

### Approaches considered and rejected

- **A. Tauri + static export (~15 MB):** would need routing surgery on the
  dynamic `editor/[project_id]` route and guarantees nothing server-only leaks
  into the client bundle. More refactor/risk than B. (Now that we know there's
  no SAB requirement, A is viable later as a slimming pass.)
- **C. Electron + standalone server (~180 MB):** most turnkey but bundles a
  full Chromium + Node. Heaviest; unnecessary given WebView2.

## Internet touchpoints to neutralize (the strip list)

| Feature | Source in code | v1 plan |
|---|---|---|
| Env validation throws without secrets | `src/env/web.ts` (`webEnvSchema.parse`) | Relax schema: make server secrets optional/defaulted so build/run never throws |
| Auth / accounts | `src/auth/client.ts`, `src/auth/server.ts`, `src/app/api/auth/[...all]/route.ts` | Stub client to a logged-out no-op; remove sign-in UI; delete/stub the auth API route |
| BotID protection | `botid/client` + `botid/next/config` in `layout.tsx` / `next.config.ts` | Remove |
| Databuddy analytics | `<Script src="https://cdn.databuddy.cc/...">` in `layout.tsx` | Remove |
| Sound library search | `src/app/api/sounds/search/route.ts` (Freesound) | Disable route + hide the UI entry (or return empty) |
| Feedback | `src/app/api/feedback/route.ts` | Disable route + hide UI entry |
| Auto-captions / transcription | `src/services/transcription/worker.ts` (`@huggingface/transformers` downloads a Whisper model) | Disable feature gracefully in v1 |
| Runtime Google Fonts | `src/fonts/google-fonts.ts` fetches `fonts.googleapis.com/css2` | Ship bundled font set; no remote fetch |
| Marketing pages w/ remote images | `blog`, `changelog`, `brand`, `contributors`, `roadmap`, `sponsors`, `privacy`, `terms`, `rss.xml`, landing `/` | Drop; redirect `/` → `/projects` |
| Marble CMS content | `content-collections.ts`, `MARBLE_*` env | Drop with marketing pages |
| Deploy infra | Cloudflare/OpenNext, Upstash, Drizzle/Postgres, Docker | Drop from the extracted project |

`next/font/google` Inter in `layout.tsx` is fine — Next self-hosts it at build
time.

## v1 scope (YAGNI)

**In:** launch straight into projects list; create/open/edit projects; import
media; timeline; preview; export. Everything stored locally (IndexedDB/OPFS).

**Out (explicit follow-ups):** auto-captions (bundle Whisper model), a local
sound library, cross-platform builds (mac/linux), static-export slimming
(approach A), auto-update.

## Success criteria

With the machine's network disabled: double-click the installed `.exe`, it
opens to the projects screen, you can create a project, import a local video,
edit on the timeline, preview, and export a file — with zero network requests
required.

## Risks

- **Tauri sidecar plumbing** (spawn node, pick free port, lifecycle/cleanup on
  quit). Mitigation: standard `tauri-plugin-shell` sidecar pattern.
- **Next 16 standalone under portable node**: verify `node server.js` runs
  from the bundled runtime. Mitigation: pin node version, test in Phase 2
  before touching Tauri.
- **Hidden internet calls** beyond the strip list. Mitigation: Phase 2 ends
  with a network-panel/offline check of the editor.
