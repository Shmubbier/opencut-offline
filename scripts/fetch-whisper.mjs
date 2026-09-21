#!/usr/bin/env node
// Downloads the Whisper base model (q4 ONNX) from the HF hub into public/models/
// so it can be bundled and served offline by the sidecar. Build-time only — the
// runtime app never touches the network. Idempotent: skips files already present.
//
// dtype q4 matches worker.ts (`dtype: "q4"`): encoder_model_q4.onnx +
// decoder_model_merged_q4.onnx (~142MB total), balanced accuracy for "base".

import { mkdirSync, existsSync, createWriteStream, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

const HF_ID = "onnx-community/whisper-base";
const BASE = `https://huggingface.co/${HF_ID}/resolve/main`;
const OUT = join(import.meta.dirname, "..", "public", "models", HF_ID);

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
async function fetchExpectedSizes() {
  const map = new Map();
  try {
    const r = await fetch(
      `https://huggingface.co/api/models/${HF_ID}/tree/main?recursive=true`,
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

async function download(rel, expected) {
  const dest = join(OUT, rel);
  const url = `${BASE}/${rel}`;
  if (existsSync(dest)) {
    const local = statSync(dest).size;
    // Complete when local matches the known size, or the size is unknown
    // (API unavailable) but the file is non-empty.
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
    throw new Error(
      `size mismatch after download ${rel}: got ${got}, expected ${expected}`,
    );
  }
  console.log(`  ok   ${rel} (${(got / 1e6).toFixed(1)} MB)`);
}

console.log(`Fetching ${HF_ID} (q4) -> ${OUT}`);
const expectedSizes = await fetchExpectedSizes();
for (const f of FILES) {
  await download(f, expectedSizes.get(f));
}
console.log("Whisper base model ready.");
