#!/usr/bin/env node
// Downloads the bundled Whisper models (q4 ONNX) from the HF hub into
// public/models/ so they can be bundled and served offline by the sidecar.
// Build-time only — the runtime app never touches the network. Idempotent +
// completeness-checked (per-file size from the HF tree API).
//
// dtype q4 matches worker.ts (`dtype: "q4"`): encoder_model_q4.onnx +
// decoder_model_merged_q4.onnx per model. base ~142MB, small ~299MB.

import {
  mkdirSync,
  existsSync,
  createWriteStream,
  statSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

const HF_ORG = "onnx-community";
const MODELS = ["whisper-base", "whisper-small"];
const MODELS_ROOT = join(import.meta.dirname, "..", "public", "models", HF_ORG);

// Config/tokenizer files transformers.js needs, plus the q4 ONNX pair.
const FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
  "merges.txt",
  "added_tokens.json",
  "special_tokens_map.json",
  "normalizer.json",
  "onnx/encoder_model_q4.onnx",
  "onnx/decoder_model_merged_q4.onnx",
];

// Authoritative per-file sizes from the HF tree API (the resolve endpoint's
// proxy doesn't expose content-length / x-linked-size, so header probing can't
// detect a truncated file). Returns a Map<path, size>; empty on failure, in
// which case we fall back to "present and non-empty" completeness.
async function fetchExpectedSizes(hfId) {
  const map = new Map();
  try {
    const r = await fetch(
      `https://huggingface.co/api/models/${hfId}/tree/main?recursive=true`,
    );
    if (!r.ok) return map;
    for (const e of await r.json()) {
      if (e.type === "file" && typeof e.size === "number") map.set(e.path, e.size);
    }
  } catch {
    /* offline / API down: map stays empty, fall back below */
  }
  return map;
}

const MAX_ATTEMPTS = 8;

async function download(rel, baseUrl, outDir, expected) {
  const dest = join(outDir, rel);
  const url = `${baseUrl}/${rel}`;
  if (existsSync(dest)) {
    const local = statSync(dest).size;
    // Complete when local matches the known size, or the size is unknown
    // (API unavailable) but the file is non-empty.
    if (local > 0 && (expected === undefined || local === expected)) {
      console.log(`  skip ${rel} (complete, ${local} bytes)`);
      return;
    }
    console.log(`  resume/refetch ${rel} (local ${local} != expected ${expected})`);
  }
  mkdirSync(dirname(dest), { recursive: true });

  // Resumable download with retry: HF's CDN supports Range, so a dropped
  // connection on a large file resumes from where it left off instead of
  // restarting. Needed because big models (~233MB) can't always complete in one
  // stream over a flaky link.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let have = existsSync(dest) ? statSync(dest).size : 0;
    if (expected !== undefined && have > expected) {
      rmSync(dest, { force: true }); // corrupt/oversized — start clean
      have = 0;
    }
    if (expected !== undefined && have === expected) break; // already complete
    try {
      const res = await fetch(url, have > 0 ? { headers: { Range: `bytes=${have}-` } } : {});
      if (have > 0 && res.status === 206) {
        await pipeline(res.body, createWriteStream(dest, { flags: "a" }));
      } else if (res.ok) {
        // Server ignored Range (or fresh start): overwrite from the beginning.
        await pipeline(res.body, createWriteStream(dest));
      } else {
        throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
      }
    } catch (e) {
      console.log(`  attempt ${attempt}/${MAX_ATTEMPTS} for ${rel} failed: ${e.message}`);
      if (attempt === MAX_ATTEMPTS) throw e;
      await new Promise((r) => setTimeout(r, 1000 * attempt)); // linear backoff
    }
  }

  const got = statSync(dest).size;
  if (expected !== undefined && got !== expected) {
    throw new Error(
      `size mismatch after download ${rel}: got ${got}, expected ${expected}`,
    );
  }
  console.log(`  ok   ${rel} (${(got / 1e6).toFixed(1)} MB)`);
}

for (const model of MODELS) {
  const hfId = `${HF_ORG}/${model}`;
  const baseUrl = `https://huggingface.co/${hfId}/resolve/main`;
  const outDir = join(MODELS_ROOT, model);
  console.log(`Fetching ${hfId} (q4) -> ${outDir}`);
  const sizes = await fetchExpectedSizes(hfId);
  for (const f of FILES) {
    await download(f, baseUrl, outDir, sizes.get(f));
  }
}
console.log("Whisper models ready.");
