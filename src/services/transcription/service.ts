import type {
	TranscriptionLanguage,
	TranscriptionResult,
	TranscriptionProgress,
	TranscriptionModelId,
} from "@/transcription/types";

type ProgressCallback = (progress: TranscriptionProgress) => void;

// ponytail: auto-captions (Whisper) are disabled for the offline build. transcribe()
// short-circuits to a rejection instead of spawning the model worker, so no network
// call is ever made. Exported names/signatures are preserved so callers still compile.
class TranscriptionService {
	async transcribe(_options: {
		audioData: Float32Array;
		language?: TranscriptionLanguage;
		modelId?: TranscriptionModelId;
		onProgress?: ProgressCallback;
	}): Promise<TranscriptionResult> {
		return Promise.reject(new Error("Auto-captions are unavailable offline."));
	}

	cancel() {
		// no-op: no worker is ever spawned.
	}

	terminate() {
		// no-op: no worker is ever spawned.
	}
}

export const transcriptionService = new TranscriptionService();
