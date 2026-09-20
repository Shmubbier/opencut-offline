import { generateUUID } from "@/utils/id";
import type { FeedbackEntry, SubmitFeedbackInput } from "./types";

// Offline stub: no Postgres backend in the desktop build, so feedback isn't
// persisted anywhere — it's just acknowledged back to the caller.
export async function submitFeedback({
	message,
}: SubmitFeedbackInput): Promise<FeedbackEntry> {
	const id = generateUUID();
	const now = new Date();

	return { id, message, createdAt: now.toISOString() };
}
