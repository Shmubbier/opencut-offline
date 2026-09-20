import type { TranscriptionSegment } from "@/transcription/types";

// ponytail: auto-captions (Whisper via @huggingface/transformers) are disabled for the
// offline build — this worker never downloads a model or runs inference. Re-enable by
// restoring the original pipeline-based implementation if online transcription returns.

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

const UNAVAILABLE_MESSAGE = "Auto-captions are unavailable offline.";

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
	const message = event.data;

	switch (message.type) {
		case "init":
			self.postMessage({
				type: "init-error",
				error: UNAVAILABLE_MESSAGE,
			} satisfies WorkerResponse);
			break;
		case "transcribe":
			self.postMessage({
				type: "transcribe-error",
				error: UNAVAILABLE_MESSAGE,
			} satisfies WorkerResponse);
			break;
		case "cancel":
			self.postMessage({ type: "cancelled" } satisfies WorkerResponse);
			break;
	}
};
