# Caption Model Picker + WebGPU Indicator — Design Spec

**Date:** 2026-09-22
**Status:** Approved
**Repo:** https://github.com/Shmubbier/opencut-offline

## Goal
Let users choose the offline caption model (accuracy vs size/speed) from the caption panel,
and surface whether transcription runs on GPU or CPU. Ship a second bundled Whisper model
(`small`) alongside the current `base`, both fully offline.

## Background (what already exists)
- `src/services/transcription/service.ts` already accepts a `modelId`, maps it to a
  `huggingFaceId` via `TRANSCRIPTION_MODELS` (`src/transcription/models.ts`), and re-inits the
  worker when the model changes. The plumbing for model selection is present; the caption UI just
  never exposes a picker (it uses `DEFAULT_TRANSCRIPTION_MODEL`).
- `src/services/transcription/worker.ts` runs `pipeline("automatic-speech-recognition", hfId,
  { dtype: "q4", device: "auto" })`. `device: "auto"` already prefers WebGPU and falls back to
  wasm — no change needed to attempt GPU.
- Only `whisper-base` (q4) is currently bundled (`public/models/onnx-community/whisper-base/`,
  gitignored, fetched by `scripts/fetch-whisper.mjs` at build time).
- `scripts/ci-smoke.mjs` + the CI model cache reference the single `whisper-base` path.

## Decisions
- **Bundled model set:** `base` (default) + `small`. Both q4, both offline. `small` adds
  ~299 MB (encoder ~66 MB + merged decoder ~233 MB) → installer ~400 MB.
- **GPU handling:** keep `device: "auto"` (WebGPU when usable, else wasm) + an honest backend
  indicator. No manual GPU/CPU toggle.

## Components

### 1. Multi-model fetch (`scripts/fetch-whisper.mjs`)
Generalize from the hardcoded `whisper-base` to a list `["whisper-base","whisper-small"]`. For
each, fetch the same per-model file set (config/generation/preprocessor/tokenizer/tokenizer_config/
vocab/merges/added_tokens/special_tokens_map/normalizer + `onnx/encoder_model_q4.onnx` +
`onnx/decoder_model_merged_q4.onnx`) into `public/models/onnx-community/<model>/`. The existing
HF-tree-API completeness check runs per model (fetch the tree per model id). Gitignored; the build
already fetches on cache-miss and copies all of `public/` into the bundle.

### 2. Trim the model list (`src/transcription/models.ts`)
`TRANSCRIPTION_MODELS` becomes exactly the bundled set: `whisper-base`, `whisper-small` (drop
`tiny`/`medium`/`large-v3-turbo` — not bundled, would fail offline; also clears the stale-list
debt). `DEFAULT_TRANSCRIPTION_MODEL = "whisper-base"`. Each entry keeps `id`, `name`,
`huggingFaceId`, `description` (description doubles as the picker hint, e.g. "Balanced" /
"Most accurate, larger download").

### 3. Model picker UI (`src/subtitles/components/assets-view.tsx`)
Add a model `Select` beside the existing language `Select`, listing `TRANSCRIPTION_MODELS`
(value = `id`, label = `name` + short hint). New `selectedModel` state defaulting to
`DEFAULT_TRANSCRIPTION_MODEL`, persisted to `localStorage` (try/catch, per the storage rules).
`handleGenerateTranscript` passes `modelId: selectedModel` to `transcriptionService.transcribe(...)`.
The existing init-progress UI is shown during model load (surface it clearly, since `small` takes
longer to load into memory). Switching models re-inits (service already handles `currentModelId`
change).

### 4. Backend indicator (`worker.ts` + service + UI)
On init, the worker determines a `backend` string: `"GPU (WebGPU)"` if
`await navigator.gpu?.requestAdapter()` returns an adapter, else `"CPU"`. Add `backend` to the
`init-complete` `WorkerResponse`; the service forwards it via `onProgress`/result to the UI, which
shows a small label ("Transcribing on GPU"/"…on CPU") in the caption panel.
**Honest caveat (documented):** we bundle `q4` weights (wasm-optimal, size-conscious). WebGPU
acceleration for `q4` is inconsistent in transformers.js; a real GPU speedup path generally needs
`fp16`/`q4f16` weights (~2× the bundle), which we deliberately do NOT bundle. So the indicator
reports GPU *availability*; WebGPU is used when it can run q4, otherwise CPU. An fp16 GPU model is
a deferred upgrade.

### 5. Build / CI plumbing
- `scripts/ci-smoke.mjs`: add `small`'s `config.json`, `tokenizer.json`, and
  `onnx/encoder_model_q4.onnx` to the 200-checks (keep base's).
- CI workflow (`.github/workflows/build.yml`): widen the model cache `path` from
  `public/models/onnx-community/whisper-base` to `public/models`, and bump the cache key
  (e.g. `whisper-models-v2-…`).

## Success criteria
- The caption panel shows a model picker (Base default, Small) and a GPU/CPU label.
- Picking Small and generating a transcript loads + runs the small model **offline** (no network).
- `fetch-whisper` pulls both models with per-file size verification; `ci-smoke` is green for both.
- The published installer contains both models and serves them over the local sidecar.

## Non-goals / deferred
- Bundling `fp16`/`q4f16` weights for real WebGPU acceleration (size cost) — deferred.
- Offering `tiny`/`medium`/`large` (not bundled) or on-demand model download (breaks offline).
- A manual GPU/CPU override toggle.

## Risks & mitigations
- **Installer ~400 MB** — accepted per the decision; documented in the README/release notes.
- **Backend introspection is best-effort** — `navigator.gpu` availability is a proxy for "GPU
  used"; labeled honestly ("GPU acceleration available/active") rather than claiming precise
  provider. Acceptable; the picker is the primary deliverable.
- **Small model memory/latency** — loading ~299 MB takes noticeable time; mitigated by showing the
  existing init-progress and keeping base as the default.
