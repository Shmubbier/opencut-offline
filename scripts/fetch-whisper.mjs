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

async function download(rel) {
  const dest = join(OUT, rel);
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`  skip ${rel} (exists)`);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  const url = `${BASE}/${rel}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  await pipeline(res.body, createWriteStream(dest));
  console.log(`  ok   ${rel} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
}

console.log(`Fetching ${HF_ID} (q4) -> ${OUT}`);
for (const f of FILES) {
  await download(f);
}
console.log("Whisper base model ready.");
