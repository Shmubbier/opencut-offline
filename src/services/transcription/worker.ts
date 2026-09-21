import {
	env,
	pipeline,
	type AutomaticSpeechRecognitionPipeline,
	type AutomaticSpeechRecognitionOutput,
} from "@huggingface/transformers";
import type { TranscriptionSegment } from "@/transcription/types";
import {
	DEFAULT_CHUNK_LENGTH_SECONDS,
	DEFAULT_STRIDE_SECONDS,
} from "@/transcription/audio";

// Offline config: force transformers.js to load the bundled model + onnxruntime
// wasm from the local sidecar only — never the HF hub or a CDN. The build stages
// the model into public/models/<hfId>/ and the ort wasm into public/ort/.
//
// IMPORTANT: this worker is instantiated from a `blob:` URL, so its base URL is
// e.g. `blob:http://127.0.0.1:<port>/<uuid>`. A root-relative path ("/models/…")
// cannot be parsed against a blob: base — `fetch("/models/…")` throws
// "Failed to parse URL", which transformers.js surfaces as "file not found
// locally". So the base MUST be an absolute, origin-qualified URL. A blob worker
// inherits the creating page's origin via self.location.origin.
const OFFLINE_ORIGIN =
	typeof self !== "undefined" &&
	self.location &&
	self.location.origin &&
	self.location.origin !== "null"
		? self.location.origin
		: "";
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${OFFLINE_ORIGIN}/models/`;
if (env.backends?.onnx?.wasm) {
	env.backends.onnx.wasm.wasmPaths = `${OFFLINE_ORIGIN}/ort/`;
	// Single-threaded: the offline sidecar doesn't send COOP/COEP headers, so
	// SharedArrayBuffer (and thus wasm threads) is unavailable in WebView2.
	env.backends.onnx.wasm.numThreads = 1;
}

export type WorkerMessage =
	| { type: "init"; modelId: string }
	| { type: "transcribe"; audio: Float32Array; language: string }
	| { type: "cancel" };

export type WorkerResponse =
	| { type: "init-progress"; progress: number }
	| { type: "init-complete" }
	| { type: "init-error"; error: string }
	| { type: "transcribe-progress"; progress: number }
	| {
			type: "transcribe-complete";
			text: string;
			segments: TranscriptionSegment[];
	  }
	| { type: "transcribe-error"; error: string }
	| { type: "cancelled" };

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let cancelled = false;
let lastReportedProgress = -1;
const fileBytes = new Map<string, { loaded: number; total: number }>();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
	const message = event.data;

	switch (message.type) {
		case "init":
			await handleInit({ modelId: message.modelId });
			break;
		case "transcribe":
			await handleTranscribe({
				audio: message.audio,
				language: message.language,
			});
			break;
		case "cancel":
			cancelled = true;
			self.postMessage({ type: "cancelled" } satisfies WorkerResponse);
			break;
	}
};

async function handleInit({ modelId }: { modelId: string }) {
	lastReportedProgress = -1;
	fileBytes.clear();

	try {
		transcriber = (await pipeline("automatic-speech-recognition", modelId, {
			dtype: "q4",
			device: "auto",
			progress_callback: (progressInfo: {
				status?: string;
				file?: string;
				loaded?: number;
				total?: number;
			}) => {
				const file = progressInfo.file;
				if (!file) return;

				const loaded = progressInfo.loaded ?? 0;
				const total = progressInfo.total ?? 0;

				if (progressInfo.status === "progress" && total > 0) {
					fileBytes.set(file, { loaded, total });
				} else if (progressInfo.status === "done") {
					const existing = fileBytes.get(file);
					if (existing) {
						fileBytes.set(file, {
							loaded: existing.total,
							total: existing.total,
						});
					}
				}

				// sum all bytes
				let totalLoaded = 0;
				let totalSize = 0;
				for (const { loaded, total } of fileBytes.values()) {
					totalLoaded += loaded;
					totalSize += total;
				}

				if (totalSize === 0) return;

				const overallProgress = (totalLoaded / totalSize) * 100;
				const roundedProgress = Math.floor(overallProgress);

				if (roundedProgress !== lastReportedProgress) {
					lastReportedProgress = roundedProgress;
					self.postMessage({
						type: "init-progress",
						progress: roundedProgress,
					} satisfies WorkerResponse);
				}
			},
		})) as unknown as AutomaticSpeechRecognitionPipeline;

		self.postMessage({ type: "init-complete" } satisfies WorkerResponse);
	} catch (error) {
		self.postMessage({
			type: "init-error",
			error: error instanceof Error ? error.message : "Failed to load model",
		} satisfies WorkerResponse);
	}
}

async function handleTranscribe({
	audio,
	language,
}: {
	audio: Float32Array;
	language: string;
}) {
	if (!transcriber) {
		self.postMessage({
			type: "transcribe-error",
			error: "Model not initialized",
		} satisfies WorkerResponse);
		return;
	}

	cancelled = false;

	try {
		const rawResult = await transcriber(audio, {
			chunk_length_s: DEFAULT_CHUNK_LENGTH_SECONDS,
			stride_length_s: DEFAULT_STRIDE_SECONDS,
			language: language === "auto" ? undefined : language,
			return_timestamps: true,
		});

		if (cancelled) return;

		const result: AutomaticSpeechRecognitionOutput = Array.isArray(rawResult)
			? rawResult[0]
			: rawResult;

		const segments: TranscriptionSegment[] = [];

		if (result.chunks) {
			for (const chunk of result.chunks) {
				if (chunk.timestamp && chunk.timestamp.length >= 2) {
					segments.push({
						text: chunk.text,
						start: chunk.timestamp[0] ?? 0,
						end: chunk.timestamp[1] ?? chunk.timestamp[0] ?? 0,
					});
				}
			}
		}

		self.postMessage({
			type: "transcribe-complete",
			text: result.text,
			segments,
		} satisfies WorkerResponse);
	} catch (error) {
		if (cancelled) return;
		self.postMessage({
			type: "transcribe-error",
			error: error instanceof Error ? error.message : "Transcription failed",
		} satisfies WorkerResponse);
	}
}
