# OpenCut Offline Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the OpenCut (classic) video editor as a native Windows `.exe` that runs fully offline.

**Architecture:** Extract the self-contained `apps/web` Next.js app from `opencut-classic` as the project root, neutralize all internet/cloud calls so it builds and runs with no secrets, then wrap the `output: "standalone"` Node server in a Tauri v2 shell that spawns it on localhost via a bundled `node.exe` sidecar and loads it in WebView2.

**Tech Stack:** Next.js 16 (App Router, React 19), `opencut-wasm` + `mediabunny` (in-browser media), IndexedDB/OPFS storage, Tauri v2 (Rust + WebView2), Bun (package manager), portable Node runtime (sidecar).

**Spec:** `docs/superpowers/specs/2026-09-20-opencut-offline-desktop-design.md`

## Global Constraints

- Source of truth for the app code: `opencut-classic` `apps/web` (a shallow clone already exists at the scratchpad path; re-clone if missing from `https://github.com/opencut-app/opencut-classic`).
- Package manager: **Bun** (`bun@1.2.18`, per `packageManager` field). Use `bun install`, `bun run <script>`.
- Next config must keep `output: "standalone"`.
- No feature may require a network request to launch or to edit/export video. Every strip-list item in the spec must be neutralized, not just hidden.
- Do **not** delete the storage migration chain (`src/services/storage/migrations/`) — the editor depends on it.
- Commit after every task. Keep the diff to the app minimal so upstream is pullable.

---

## Phase 1 — Fork & standalone project

### Task 1: Extract `apps/web` as the project root

**Files:**
- Create: whole project tree in `D:/TenTne Projects/OpenCut_Local-Fork/` (copied from `opencut-classic/apps/web`)
- Create: `.gitignore`, `README.md`
- Delete (do not copy): monorepo/rust/cloudflare/docker baggage

- [ ] **Step 1: Copy the web app to the project root**

Copy the *contents* of `opencut-classic/apps/web/` into the working directory (preserve the existing `docs/` folder already there). Do **not** copy: `Dockerfile`, `wrangler.jsonc`, `open-next.config.ts`, `drizzle.config.ts`, `migrations/` (the Drizzle SQL dir at web root — distinct from `src/services/storage/migrations/`), `content-collections.ts`.

```bash
# from an interactive shell; SRC = the scratchpad clone's apps/web
# (copies everything, then removes the deploy-only files)
```

- [ ] **Step 2: Remove deploy-only deps from `package.json`**

Delete these dependencies: `@opennextjs/cloudflare`, `@upstash/ratelimit`, `@upstash/redis`, `better-auth`, `botid`, `drizzle-orm`, `pg`, `postgres`, `@content-collections/*`, `feed`. Delete the `preview`, `deploy`, `db:*` scripts. Keep `dev`, `build`, `start`, `lint`.

- [ ] **Step 3: Init git and install**

Run:
```bash
git init && git add -A && git commit -m "chore: fork opencut-classic web app as offline desktop base"
bun install
```
Expected: install completes (may surface missing imports from removed deps — those are fixed in Phase 2).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: standalone project scaffold"
```

---

## Phase 2 — Make it build & run offline

### Task 2: Relax env validation so the app builds without secrets

**Files:**
- Modify: `src/env/web.ts`

**Interfaces:**
- Produces: `webEnv` object importable everywhere with no required secrets.

- [ ] **Step 1: Make server secrets optional**

In `src/env/web.ts`, change every server-only field (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `MARBLE_WORKSPACE_KEY`, `FREESOUND_CLIENT_ID`, `FREESOUND_API_KEY`, `NEXT_PUBLIC_MARBLE_API_URL`) to `.optional()`, and use `safeParse` so a missing var never throws:

```ts
const parsed = webEnvSchema.safeParse(process.env);
export const webEnv = parsed.success ? parsed.data : ({ NODE_ENV: process.env.NODE_ENV ?? "production" } as WebEnv);
```
Make `NEXT_PUBLIC_SITE_URL` default to `http://localhost:3000` (already defaulted) and `NEXT_PUBLIC_MARBLE_API_URL` `.optional()`.

- [ ] **Step 2: Verify it imports without env**

Run:
```bash
node -e "process.env.NODE_ENV='production'; require('tsx/cjs'); require('./src/env/web.ts')" 2>&1 | head
```
(If `tsx` isn't present, defer this check to the Task 7 build.) Expected: no throw.

- [ ] **Step 3: Commit**

```bash
git add src/env/web.ts && git commit -m "fix: don't require cloud secrets to build/run"
```

### Task 3: Strip analytics, BotID, and neutralize auth

**Files:**
- Modify: `src/app/layout.tsx`, `next.config.ts`
- Modify/Replace: `src/auth/client.ts`, `src/auth/server.ts`
- Delete: `src/app/api/auth/[...all]/route.ts`

- [ ] **Step 1: Clean `layout.tsx`**

Remove: the `import { BotIdClient } from "botid/client"` and its `<BotIdClient .../>`, the `protectedRoutes` array, and the databuddy `<Script src="https://cdn.databuddy.cc/...">`. Keep ThemeProvider, TooltipProvider, Toaster, Inter font.

- [ ] **Step 2: Clean `next.config.ts`**

Remove `withBotId` and `withContentCollections` wrappers and their imports; export the plain `nextConfig`. Keep `output: "standalone"` and `reactStrictMode`. Drop the marketing-only `images.remotePatterns` (harmless to keep, but cleaner gone).

- [ ] **Step 3: Stub auth**

Replace `src/auth/client.ts` and `src/auth/server.ts` with no-op stubs exposing the same named exports the app imports (e.g. a `useSession` returning `{ data: null }`, `signIn`/`signOut` as no-ops). Grep first to see exact export names consumed:
```bash
grep -rn "from \"@/auth/client\"\|from \"@/auth/server\"" src
```
Match those names in the stub. Delete `src/app/api/auth/[...all]/route.ts`.

- [ ] **Step 4: Verify no dangling imports**

Run:
```bash
grep -rn "botid\|databuddy\|better-auth\|content-collections" src next.config.ts
```
Expected: no results (except comments).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: strip analytics/botid, neutralize auth"
```

### Task 4: Launch into the editor; drop marketing routes

**Files:**
- Modify: `src/app/page.tsx`
- Delete: `src/app/blog`, `changelog`, `brand`, `contributors`, `roadmap`, `sponsors`, `privacy`, `terms`, `rss.xml`, `robots.ts`, `sitemap.ts`, `base-page.tsx`, and `src/components/landing/`, `src/components/header.tsx`, `src/components/footer.tsx` (only if not imported by editor/projects)
- Modify: any nav that links to deleted routes

- [ ] **Step 1: Redirect root to the app**

Replace `src/app/page.tsx` with:
```tsx
import { redirect } from "next/navigation";
export default function Home() {
	redirect("/projects");
}
```

- [ ] **Step 2: Delete marketing routes and check for imports**

Before deleting `header`/`footer`/`landing`, run:
```bash
grep -rn "components/header\|components/footer\|components/landing" src/app/projects src/app/editor src/components/editor
```
Delete only what the editor/projects trees don't import. If projects/editor import a shared `Header`, keep it but strip its links to deleted routes.

- [ ] **Step 3: Verify routes resolve**

Run:
```bash
grep -rn "href=\"/blog\|/changelog\|/roadmap\|/sponsors\|/contributors\|/brand" src
```
Expected: no live links to deleted pages (fix any found).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: launch straight into /projects, drop marketing pages"
```

### Task 5: Disable remote API routes and the runtime font fetch

**Files:**
- Delete: `src/app/api/sounds/search/route.ts`, `src/app/api/feedback/route.ts`
- Keep: `src/app/api/health/route.ts` (used by the Tauri health check in Phase 3)
- Modify: `src/fonts/google-fonts.ts` and its callers; the sounds/feedback UI entry points

- [ ] **Step 1: Remove the remote API routes**

Delete `api/sounds/search` and `api/feedback`. Grep their callers and make the UI gracefully absent (hide the sounds search panel entry and the feedback button):
```bash
grep -rn "api/sounds/search\|api/feedback\|/api/sounds" src
```
Replace fetches with a no-op returning empty results, or hide the control.

- [ ] **Step 2: Kill the runtime Google Fonts fetch**

In `src/fonts/google-fonts.ts` the constant `GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2"` drives a remote font picker. Grep callers:
```bash
grep -rn "google-fonts\|GOOGLE_FONTS_CSS\|fonts.googleapis" src
```
Replace the remote font list with a bundled/local set (start with the fonts already shipped under `public/` or the single Inter family) and remove the network fetch. The font picker should list only locally-available fonts.

- [ ] **Step 3: Verify no editor-path network calls remain**

Run:
```bash
grep -rn "https://\|http://" src/components/editor src/timeline src/preview src/services | grep -v "localhost\|127.0.0.1\|http://www.w3.org\|comment"
```
Review each hit; neutralize any that fire during edit/export.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: remove remote sounds/feedback/font fetches"
```

### Task 6: Disable auto-captions (Whisper) gracefully

**Files:**
- Modify: `src/services/transcription/worker.ts` and its UI entry point

- [ ] **Step 1: Find the captions UI trigger**

Run:
```bash
grep -rln "transcription\|caption\|whisper\|@huggingface/transformers" src
```

- [ ] **Step 2: Gate the feature off**

Hide/disable the captions control and make the worker a no-op that resolves with an empty/"unavailable offline" result rather than importing `@huggingface/transformers` (which would fetch a model). Remove `@huggingface/transformers` from `package.json` if nothing else imports it.

- [ ] **Step 3: Verify**

Run:
```bash
grep -rn "@huggingface/transformers" src
```
Expected: no active imports.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: disable online auto-captions for offline v1"
```

### Task 7: Prove the web app builds and edits offline

**Files:** none (verification task)

- [ ] **Step 1: Build**

Run:
```bash
bun run build
```
Expected: build succeeds, prints `.next/standalone` output. Fix any remaining broken imports from stripped deps until green.

- [ ] **Step 2: Run the standalone server**

Run:
```bash
node .next/standalone/server.js
```
(Set `PORT=3000` if needed. If static assets 404, copy `.next/static` → `.next/standalone/.next/static` and `public` → `.next/standalone/public` — this copy step becomes part of the Phase 3 build script.)

- [ ] **Step 3: Manual offline check**

In a browser at `http://localhost:3000`: it redirects to `/projects`; create a project; import a local video; the timeline + preview work; run an export. With the browser devtools Network tab open and the machine offline, confirm no failed required requests.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "chore: green offline build of the web app"
```

---

## Phase 3 — Tauri desktop shell (approach B)

### Task 8: Add the Tauri v2 scaffold

**Files:**
- Create: `src-tauri/` (`Cargo.toml`, `tauri.conf.json`, `src/main.rs`, `build.rs`, `icons/`)
- Modify: `package.json` (add `@tauri-apps/cli` dev dep + `tauri` script)

- [ ] **Step 1: Scaffold Tauri**

Run:
```bash
bun add -d @tauri-apps/cli
bunx tauri init --app-name "OpenCut" --window-title "OpenCut" --frontend-dist ../.next/standalone --dev-url http://localhost:3000 --before-dev-command "" --before-build-command ""
```
(Adjust prompts; we drive the window from Rust, not from `frontendDist` directly — see Task 9.)

- [ ] **Step 2: Confirm it opens a blank window**

Run:
```bash
bunx tauri dev
```
Expected: an empty OpenCut window opens (WebView2). Close it.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: add tauri v2 shell"
```

### Task 9: Spawn the Next server as a node sidecar and load it

**Files:**
- Create: `src-tauri/binaries/` (portable `node.exe` named per Tauri sidecar convention, e.g. `node-x86_64-pc-windows-msvc.exe`)
- Modify: `src-tauri/tauri.conf.json` (register the sidecar + bundle `.next/standalone` as a resource), `src-tauri/src/main.rs`
- Add: `tauri-plugin-shell` dependency

- [ ] **Step 1: Register the sidecar and resources**

In `tauri.conf.json`, add the node binary to `bundle.externalBin` and the standalone server dir to `bundle.resources`. Add `tauri-plugin-shell` to `Cargo.toml` and `main.rs`.

- [ ] **Step 2: Spawn node, pick a free port, health-check, then show the window**

In `src/main.rs`: on setup, pick a free localhost port, spawn the sidecar with the resolved `server.js` resource path and `PORT`/`HOSTNAME=127.0.0.1` env, poll `http://127.0.0.1:<port>/api/health` until 200 (timeout ~30s), then navigate the main window to that URL. On app exit, kill the child.

```rust
// sketch: use tauri_plugin_shell::ShellExt; sidecar("node").args([server_js, ...]).spawn();
// poll health, then window.eval(format!("window.location.replace('http://127.0.0.1:{port}/')"))
```

- [ ] **Step 3: Run in dev against a real build**

Run `bun run build`, copy `.next/static` + `public` into `.next/standalone` (Step from Task 7), then:
```bash
bunx tauri dev
```
Expected: the window loads `/projects` from the sidecar server.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: run bundled next server as tauri node sidecar"
```

### Task 10: One-command build pipeline → Windows exe/installer

**Files:**
- Create: `scripts/build-desktop.mjs` (or npm scripts)
- Modify: `package.json` (`desktop:build` script), `src-tauri/tauri.conf.json` (`beforeBuildCommand`, bundle targets)

- [ ] **Step 1: Wire the build order**

`desktop:build` must: `bun run build` → copy `.next/static` and `public` into `.next/standalone` → `bunx tauri build`. Encode the copy in `scripts/build-desktop.mjs` so it's deterministic; set `tauri.conf.json` `bundle.targets` to `["nsis"]` (Windows installer) and/or `["app"]`.

- [ ] **Step 2: Produce the installer**

Run:
```bash
bun run desktop:build
```
Expected: a Windows installer/exe under `src-tauri/target/release/bundle/`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: one-command desktop build producing windows exe"
```

### Task 11: Verify the built exe runs fully offline

**Files:** none (verification task)

- [ ] **Step 1: Install and launch offline**

Disable the machine's network. Install from the built installer, launch `OpenCut`.
Expected: window opens to `/projects` (sidecar server started, health check passed).

- [ ] **Step 2: End-to-end edit/export**

Create a project, import a local video, edit on the timeline, preview, export a file. Expected: all succeed with no network.

- [ ] **Step 3: Confirm no orphan process**

Quit the app; confirm the node sidecar process is gone (Task Manager).

- [ ] **Step 4: Tag the release**

```bash
git add -A && git commit -m "docs: verified offline v1" && git tag v0.1.0-offline
```

---

## Self-Review notes

- **Spec coverage:** every strip-list row maps to a task — env (T2), auth/botid/databuddy (T3), marketing/`/` redirect (T4), sounds/feedback/fonts (T5), captions (T6), deploy infra (T1). Packaging B: T8–T10; success criteria: T11.
- **Health route:** kept in T5 specifically because T9's health check uses `/api/health`.
- **Static asset copy:** the `.next/static`/`public` → standalone copy is called out in T7 and made deterministic in T10 to avoid the classic standalone-404 trap.
- **Open risk to resolve during execution:** exact named exports of `src/auth/*` (T3 Step 3 greps them) and the precise captions UI entry (T6 Step 1 greps it) — grounded by grep rather than guessed.
