import type {
	TranscriptionModel,
	TranscriptionModelId,
} from "./types";

// Only models bundled offline (public/models/onnx-community/<id>/) may be
// listed — the picker can't offer a model that isn't in the installer.
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

export const DEFAULT_TRANSCRIPTION_MODEL: TranscriptionModelId =
	"whisper-base";
