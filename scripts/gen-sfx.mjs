#!/usr/bin/env node
// Generates a small bundled pack of original, synthesized CC0 sound effects
// (44.1kHz, 16-bit, mono PCM WAV) into public/sfx/, plus a manifest.json.
// No dependencies — raw PCM synthesis + a hand-written WAV header.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "sfx");
const SAMPLE_RATE = 44100;

mkdirSync(OUT_DIR, { recursive: true });

/** Writes a 44-byte canonical RIFF/WAVE header followed by 16-bit PCM samples. */
function encodeWav(samples) {
	const dataSize = samples.length * 2; // 16-bit = 2 bytes/sample
	const buffer = Buffer.alloc(44 + dataSize);

	buffer.write("RIFF", 0, "ascii");
	buffer.writeUInt32LE(36 + dataSize, 4);
	buffer.write("WAVE", 8, "ascii");
	buffer.write("fmt ", 12, "ascii");
	buffer.writeUInt32LE(16, 16); // fmt chunk size (PCM)
	buffer.writeUInt16LE(1, 20); // audio format: PCM
	buffer.writeUInt16LE(1, 22); // channels: mono
	buffer.writeUInt32LE(SAMPLE_RATE, 24);
	buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate = sampleRate * blockAlign
	buffer.writeUInt16LE(2, 32); // block align = channels * bytesPerSample
	buffer.writeUInt16LE(16, 34); // bits per sample
	buffer.write("data", 36, "ascii");
	buffer.writeUInt32LE(dataSize, 40);

	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));
		buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
	}

	return buffer;
}

/** Linear envelope: fades in over `attack` seconds, out over `release` seconds. */
function envelope(t, duration, attack = 0.005, release = 0.05) {
	if (t < attack) return t / attack;
	const timeLeft = duration - t;
	if (timeLeft < release) return Math.max(0, timeLeft / release);
	return 1;
}

function sine(freq, duration, { attack, release, amp = 0.6 } = {}) {
	const n = Math.round(duration * SAMPLE_RATE);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const t = i / SAMPLE_RATE;
		out[i] = Math.sin(2 * Math.PI * freq * t) * amp * envelope(t, duration, attack, release);
	}
	return out;
}

/** Frequency sweep from f0 to f1 (linear), useful for whoosh/transition sfx. */
function sweep(f0, f1, duration, { attack, release, amp = 0.5 } = {}) {
	const n = Math.round(duration * SAMPLE_RATE);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const t = i / SAMPLE_RATE;
		const freq = f0 + (f1 - f0) * (t / duration);
		out[i] = Math.sin(2 * Math.PI * freq * t) * amp * envelope(t, duration, attack, release);
	}
	return out;
}

/** Filtered-ish noise burst (simple leaky-integrator lowpass on white noise). */
function noiseBurst(duration, { amp = 0.5, smoothing = 0.9 } = {}) {
	const n = Math.round(duration * SAMPLE_RATE);
	const out = new Float32Array(n);
	let prev = 0;
	for (let i = 0; i < n; i++) {
		const t = i / SAMPLE_RATE;
		const white = Math.random() * 2 - 1;
		prev = prev * smoothing + white * (1 - smoothing);
		out[i] = prev * amp * envelope(t, duration, 0.001, duration * 0.8);
	}
	return out;
}

function concat(...chunks) {
	const total = chunks.reduce((sum, c) => sum + c.length, 0);
	const out = new Float32Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

function mix(...chunks) {
	const len = Math.max(...chunks.map((c) => c.length));
	const out = new Float32Array(len);
	for (const c of chunks) {
		for (let i = 0; i < c.length; i++) out[i] += c[i];
	}
	return out;
}

function silence(duration) {
	return new Float32Array(Math.round(duration * SAMPLE_RATE));
}

// --- The pack ---------------------------------------------------------

const sfx = [
	{
		name: "Click",
		file: "click.wav",
		samples: sine(1200, 0.06, { attack: 0.001, release: 0.04, amp: 0.7 }),
	},
	{
		name: "Pop",
		file: "pop.wav",
		samples: sweep(1800, 400, 0.12, { attack: 0.002, release: 0.08, amp: 0.7 }),
	},
	{
		name: "Beep",
		file: "beep.wav",
		samples: sine(880, 0.2, { attack: 0.01, release: 0.08, amp: 0.6 }),
	},
	{
		name: "Whoosh",
		file: "whoosh.wav",
		samples: mix(
			sweep(200, 2000, 0.35, { attack: 0.02, release: 0.2, amp: 0.35 }),
			noiseBurst(0.35, { amp: 0.3, smoothing: 0.7 }),
		),
	},
	{
		name: "Chime",
		file: "chime.wav",
		samples: mix(
			sine(1046.5, 0.6, { attack: 0.005, release: 0.5, amp: 0.35 }),
			sine(1568, 0.6, { attack: 0.005, release: 0.5, amp: 0.25 }),
		),
	},
	{
		name: "Transition",
		file: "transition.wav",
		samples: concat(
			sweep(300, 1200, 0.2, { attack: 0.01, release: 0.05, amp: 0.4 }),
			sweep(1200, 2400, 0.2, { attack: 0.01, release: 0.15, amp: 0.4 }),
		),
	},
	{
		name: "Success",
		file: "success.wav",
		samples: concat(
			sine(523.25, 0.12, { attack: 0.005, release: 0.05, amp: 0.5 }),
			sine(659.25, 0.12, { attack: 0.005, release: 0.05, amp: 0.5 }),
			sine(783.99, 0.22, { attack: 0.005, release: 0.15, amp: 0.5 }),
		),
	},
	{
		name: "Error",
		file: "error.wav",
		samples: concat(
			sine(300, 0.15, { attack: 0.005, release: 0.05, amp: 0.5 }),
			silence(0.03),
			sine(220, 0.25, { attack: 0.005, release: 0.15, amp: 0.5 }),
		),
	},
];

const manifest = { sounds: [] };

sfx.forEach((s, idx) => {
	const wav = encodeWav(s.samples);
	writeFileSync(join(OUT_DIR, s.file), wav);
	manifest.sounds.push({
		id: idx + 1,
		name: s.name,
		file: s.file,
		duration: Math.round((s.samples.length / SAMPLE_RATE) * 1000) / 1000,
	});
	console.log(`wrote ${s.file} (${wav.length} bytes, ${manifest.sounds[idx].duration}s)`);
});

writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, "\t") + "\n");
console.log(`wrote manifest.json (${manifest.sounds.length} sounds)`);
