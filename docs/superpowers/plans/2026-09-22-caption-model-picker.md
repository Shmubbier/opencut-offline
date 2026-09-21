# Caption Model Picker + WebGPU Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a caption model picker (Base default, Small) with a GPU/CPU backend indicator, shipping both Whisper models bundled/offline.

**Architecture:** The transcription service/worker already support a `modelId` and `device: "auto"` (WebGPU→wasm). This adds a second bundled model (`small`), trims the model list to the bundled set, exposes a picker in the caption panel, and reports the resolved backend. Weights stay `q4` (no fp16 GPU variants — deferred for size).

**Tech Stack:** Next.js/React, `@huggingface/transformers` (transformers.js) in a Web Worker, Node ESM build scripts, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-22-caption-model-picker-design.md`

## Global Constraints
- Offline = bundled: only models present under `public/models/onnx-community/<model>/` may be offered. Bundled set: `whisper-base`, `whisper-small`. No on-demand download.
- Weights are `q4` (encoder_model_q4.onnx + decoder_model_merged_q4.onnx). Do NOT bundle fp16/q4f16.
- Models are gitignored + fetched at build; never commit them. Installer grows to ~400 MB (small ~299 MB).
- Keep `device: "auto"` in the worker (do not force a backend).
- tsc baseline is 13 pre-existing errors; changes must not increase it (`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`).
- Commit after each task.

## File Structure
- `scripts/fetch-whisper.mjs` (modify) — fetch a list of models.
- `src/transcription/models.ts` (modify) — trim to bundled set.
- `src/services/transcription/worker.ts` (modify) — report backend on init.
- `src/transcription/types.ts` (modify) — add `backend?` to progress.
- `src/services/transcription/service.ts` (modify) — forward backend.
- `src/subtitles/components/assets-view.tsx` (modify) — model picker + backend label.
- `scripts/ci-smoke.mjs` (modify) — check small's assets.
- `.github/workflows/build.yml` (modify) — widen model cache.

---

## Task 1: Bundle both models (fetch-whisper multi-model + trim models.ts)

**Files:**
- Modify: `scripts/fetch-whisper.mjs`
- Modify: `src/transcription/models.ts`

**Interfaces:**
- Produces: `node scripts/fetch-whisper.mjs` populates `public/models/onnx-community/whisper-base/` AND `.../whisper-small/`, each completeness-checked. `TRANSCRIPTION_MODELS` exports exactly `[whisper-base, whisper-small]`; `DEFAULT_TRANSCRIPTION_MODEL = "whisper-base"`.

- [ ] **Step 1: Make `scripts/fetch-whisper.mjs` loop over multiple models**

Replace the single-model constants + final loop. Change `HF_ID`/`BASE`/`OUT` usage: introduce a `MODELS` list and per-model tree fetch. Keep `FILES`, `fetchExpectedSizes` (make it take an id), and `download` (make it take an `outDir`).

Replace the top constants:
```js
const HF_ORG = "onnx-community";
const MODELS = ["whisper-base", "whisper-small"];
const MODELS_ROOT = join(import.meta.dirname, "..", "public", "models", HF_ORG);
```
Change `fetchExpectedSizes` to accept a model id:
```js
async function fetchExpectedSizes(hfId) {
  const map = new Map();
  try {
    const r = await fetch(`https://huggingface.co/api/models/${hfId}/tree/main?recursive=true`);
    if (!r.ok) return map;
    for (const e of await r.json()) {
      if (e.type === "file" && typeof e.size === "number") map.set(e.path, e.size);
    }
  } catch { /* offline: fall back below */ }
  return map;
}
```
Change `download` to take an output dir + base url:
```js
async function download(rel, baseUrl, outDir, expected) {
  const dest = join(outDir, rel);
  const url = `${baseUrl}/${rel}`;
  if (existsSync(dest)) {
    const local = statSync(dest).size;
    if (local > 0 && (expected === undefined || local === expected)) {
      console.log(`  skip ${rel} (complete, ${local} bytes)`);
      return;
    }
    console.log(`  refetch ${rel} (local ${local} != expected ${expected})`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  await pipeline(res.body, createWriteStream(dest));
  const got = statSync(dest).size;
  if (expected !== undefined && got !== expected) {
    throw new Error(`size mismatch after download ${rel}: got ${got}, expected ${expected}`);
  }
  console.log(`  ok   ${rel} (${(got / 1e6).toFixed(1)} MB)`);
}
```
Replace the final run block:
```js
for (const model of MODELS) {
  const hfId = `${HF_ORG}/${model}`;
  const baseUrl = `https://huggingface.co/${hfId}/resolve/main`;
  const outDir = join(MODELS_ROOT, model);
  console.log(`Fetching ${hfId} (q4) -> ${outDir}`);
  const sizes = await fetchExpectedSizes(hfId);
  for (const f of FILES) await download(f, baseUrl, outDir, sizes.get(f));
}
console.log("Whisper models ready.");
```
Keep the `FILES` array and imports as-is. Remove the now-unused `HF_ID`/`BASE`/`OUT` constants.

- [ ] **Step 2: Trim `src/transcription/models.ts` to the bundled set**

Set `TRANSCRIPTION_MODELS` to exactly base + small (remove tiny/small-was-there? keep small; remove tiny/medium/large-v3-turbo). Final:
```ts
export const TRANSCRIPTION_MODELS: TranscriptionModel[] = [
	{
		id: "whisper-base",
		name: "Base",
		huggingFaceId: "onnx-community/whisper-base",
		description: "Balanced speed and accuracy (default)",
	},
	{
		id: "whisper-small",
		name: "Small",
		huggingFaceId: "onnx-community/whisper-small",
		description: "Most accurate, larger and slower",
	},
];

export const DEFAULT_TRANSCRIPTION_MODEL: TranscriptionModelId = "whisper-base";
```
If `TranscriptionModelId` is a union type in `src/transcription/types.ts` that lists the removed ids, narrow it to `"whisper-base" | "whisper-small"` (check and update to avoid a type error).

- [ ] **Step 3: Verify**
```bash
grep -c "onnx-community/whisper" src/transcription/models.ts   # expect 2
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"  # <= 13
# fetch (pulls small ~299MB — needs internet; long). To verify wiring cheaply, check base still skips and small's config downloads:
node scripts/fetch-whisper.mjs 2>&1 | grep -E "whisper-small|whisper-base" | head
```
Expected: models.ts has 2 model entries; tsc not increased; fetch logs both `whisper-base` and `whisper-small` targets. (Full small download is long; it's completed in Task 4. If offline, note it.)

- [ ] **Step 4: Commit**
```bash
git add scripts/fetch-whisper.mjs src/transcription/models.ts
git commit -m "feat: bundle whisper base + small; fetch both, trim model list to bundled set"
```

---

## Task 2: Report the execution backend (worker + service + progress type)

**Files:**
- Modify: `src/services/transcription/worker.ts`
- Modify: `src/transcription/types.ts`
- Modify: `src/services/transcription/service.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WorkerResponse` `init-complete` carries `backend: string`; `TranscriptionProgress` has optional `backend?: string`; the service emits an `onProgress` update carrying `backend` once the model is loaded.

- [ ] **Step 1: worker.ts — add `backend` to init-complete**

Change the `init-complete` variant of `WorkerResponse`:
```ts
	| { type: "init-complete"; backend: string }
```
In `handleInit`, after the `pipeline(...)` call succeeds and before posting `init-complete`, compute the backend and include it:
```ts
		let backend = "CPU";
		try {
			const adapter =
				typeof navigator !== "undefined" && navigator.gpu
					? await navigator.gpu.requestAdapter()
					: null;
			if (adapter) backend = "GPU (WebGPU)";
		} catch {
			/* no WebGPU: stay CPU */
		}
		self.postMessage({ type: "init-complete", backend } satisfies WorkerResponse);
```
(Replace the existing bare `self.postMessage({ type: "init-complete" } ...)`.)

- [ ] **Step 2: types.ts — add optional `backend` to `TranscriptionProgress`**
```ts
export interface TranscriptionProgress {
	status: TranscriptionStatus;
	progress: number;
	message?: string;
	backend?: string;
}
```

- [ ] **Step 3: service.ts — forward the backend to onProgress**

In `ensureWorker`'s `handleMessage`, the `init-complete` case gains the backend and emits a progress update before resolving:
```ts
					case "init-complete":
						this.worker?.removeEventListener("message", handleMessage);
						this.isInitialized = true;
						this.isInitializing = false;
						this.currentModelId = modelId;
						onProgress?.({
							status: "loading-model",
							progress: 100,
							message: `${model.name} ready`,
							backend: response.backend,
						});
						resolve();
						break;
```
(`response.backend` is now typed because of Step 1.)

- [ ] **Step 4: Verify**
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"  # <= 13
grep -n "backend" src/services/transcription/worker.ts src/services/transcription/service.ts src/transcription/types.ts
```
Expected: tsc not increased; `backend` present in all three files.

- [ ] **Step 5: Commit**
```bash
git add src/services/transcription/worker.ts src/services/transcription/service.ts src/transcription/types.ts
git commit -m "feat: report transcription backend (GPU/CPU) from the worker"
```

---

## Task 3: Caption panel model picker + backend label

**Files:**
- Modify: `src/subtitles/components/assets-view.tsx`

**Interfaces:**
- Consumes: `TRANSCRIPTION_MODELS`, `DEFAULT_TRANSCRIPTION_MODEL` (Task 1); `TranscriptionProgress.backend` (Task 2).

- [ ] **Step 1: Imports + state**

Add imports at the top of `assets-view.tsx` (near the existing transcription imports):
```ts
import {
	TRANSCRIPTION_MODELS,
	DEFAULT_TRANSCRIPTION_MODEL,
} from "@/transcription/models";
import type { TranscriptionModelId } from "@/transcription/types";
```
In `Captions()`, next to `selectedLanguage`, add persisted model state + a backend label:
```ts
	const [selectedModel, setSelectedModel] = useState<TranscriptionModelId>(() => {
		try {
			const saved = localStorage.getItem("opencut.captionModel");
			if (saved && TRANSCRIPTION_MODELS.some((m) => m.id === saved)) {
				return saved as TranscriptionModelId;
			}
		} catch {
			/* ignore */
		}
		return DEFAULT_TRANSCRIPTION_MODEL;
	});
	const [backend, setBackend] = useState<string | null>(null);

	const handleModelChange = (value: string) => {
		setSelectedModel(value as TranscriptionModelId);
		try {
			localStorage.setItem("opencut.captionModel", value);
		} catch {
			/* ignore */
		}
	};
```

- [ ] **Step 2: Capture backend from progress**

In `handleProgress`, record the backend when present:
```ts
	const handleProgress = (progress: TranscriptionProgress) => {
		if (progress.backend) setBackend(progress.backend);
		if (progress.status === "loading-model") {
			dispatch({
				type: "update_step",
				step: `Loading model ${Math.round(progress.progress)}%`,
			});
		} else if (progress.status === "transcribing") {
			dispatch({ type: "update_step", step: "Transcribing..." });
		}
	};
```

- [ ] **Step 3: Pass the model to transcribe**

In `handleGenerateTranscript`, add `modelId` to the `transcriptionService.transcribe({...})` call:
```ts
			const result = await transcriptionService.transcribe({
				audioData: samples,
				language: selectedLanguage === "auto" ? undefined : selectedLanguage,
				modelId: selectedModel,
				onProgress: handleProgress,
			});
```

- [ ] **Step 4: Add the model Select + backend label to the UI**

In the render, add a `SectionField label="Model"` with a Select BEFORE the existing `SectionField label="Language"` block (mirror its structure):
```tsx
						<SectionField label="Model">
							<Select value={selectedModel} onValueChange={handleModelChange}>
								<SelectTrigger>
									<SelectValue placeholder="Select a model" />
								</SelectTrigger>
								<SelectContent>
									{TRANSCRIPTION_MODELS.map((model) => (
										<SelectItem key={model.id} value={model.id}>
											{model.name} — {model.description}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
```
And a small backend label after the language `SectionField` (only when known):
```tsx
						{backend && (
							<p className="text-muted-foreground text-xs">
								Runs on: {backend}
							</p>
						)}
```

- [ ] **Step 5: Verify**
```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"  # <= 13
grep -n "selectedModel\|opencut.captionModel\|Runs on" src/subtitles/components/assets-view.tsx
```
Expected: tsc not increased; the new state/persistence/label present. (Runtime click-through is covered in Task 4's rebuild.)

- [ ] **Step 6: Commit**
```bash
git add src/subtitles/components/assets-view.tsx
git commit -m "feat: caption model picker (base/small) + GPU/CPU label, persisted"
```

---

## Task 4: CI/smoke updates + fetch small + rebuild + offline verify

**Files:**
- Modify: `scripts/ci-smoke.mjs`
- Modify: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: the multi-model fetch (Task 1) and the bundled small model.

- [ ] **Step 1: ci-smoke.mjs — check small's assets too**

In the `PATHS` array, add the three small-model URLs after the base ones:
```js
  "/models/onnx-community/whisper-small/config.json",
  "/models/onnx-community/whisper-small/tokenizer.json",
  "/models/onnx-community/whisper-small/onnx/encoder_model_q4.onnx",
```

- [ ] **Step 2: workflow — widen the model cache**

In `.github/workflows/build.yml`, change the "Cache Whisper model" step's `path` and `key`:
```yaml
      - name: Cache Whisper models
        uses: actions/cache@v4
        with:
          path: public/models
          key: whisper-models-v2-${{ hashFiles('scripts/fetch-whisper.mjs') }}
```

- [ ] **Step 3: Fetch the small model locally + rebuild**
```bash
BUN="/c/Users/naomi/AppData/Local/Microsoft/WinGet/Packages/Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe/bun-windows-x64/bun.exe"
node scripts/fetch-whisper.mjs                 # pulls small (~299MB) — long, needs internet
BUN="$BUN" node scripts/build-desktop.mjs      # rebuild installer with both models (long; foreground)
```
(Windows note: run the build foreground; if it exceeds the tool timeout it auto-moves to background and completes. Set `$BUN` to the native Windows bun path form.)

- [ ] **Step 4: Smoke-test both models offline**
```bash
SMOKE_PORT=3410 node scripts/ci-smoke.mjs
```
Expected: every line `PASS 200`, including the three `whisper-small` URLs; exit 0.

- [ ] **Step 5: Manual offline check (best-effort)**

Serve `.next/standalone` and, in a browser, open the editor → Captions: confirm the Model picker lists Base + Small, and (if drivable) generating with Small loads the small model and shows a "Runs on: …" label with no external network. If the UI can't be fully driven, rely on the smoke test + reason from the wiring, and note it.

- [ ] **Step 6: Commit**
```bash
git add scripts/ci-smoke.mjs .github/workflows/build.yml
git commit -m "ci: bundle+smoke the small model; cache all whisper models"
```

- [ ] **Step 7: Release (HOLD for user)**

Do NOT tag/release without explicit user go-ahead. When approved: bump `version` in `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml` (+ Cargo.lock app entry), commit, push master, then `git tag vX.Y.Z && git push origin vX.Y.Z` — CI publishes the release. (Installer will be ~400 MB.)

---

## Self-Review notes
- **Spec coverage:** bundle base+small (T1 fetch + T4 fetch/build), trim list (T1), picker UI + persistence (T3), backend indicator worker→service→UI (T2+T3), CI cache + smoke for small (T4), release held (T4 Step 7). All spec sections mapped.
- **Placeholder scan:** none — all code inline.
- **Type consistency:** `TranscriptionModelId` narrowed in T1 and consumed in T3; `backend` added to `init-complete` (T2 Step 1) and read in service (T2 Step 3) and UI (T3 Step 2); `modelId` param already exists on `transcribe`. `selectedModel`/`handleModelChange`/`opencut.captionModel` consistent across T3.
- **Honesty:** backend label reports WebGPU *availability* (proxy for use), per the spec's documented caveat; q4-only (no fp16) is a stated non-goal.
- **Verification:** T1–T3 have tsc + grep checks; T4 is the integration (fetch small, rebuild, smoke both models offline) and holds the release for the user.
