// Offline stub: no Upstash/Redis backend in the desktop build, so rate
// limiting is a no-op (there's no shared network surface to protect here).

export async function checkRateLimit(_args: {
	request: Request;
}): Promise<{ success: boolean; limited: boolean }> {
	return { success: true, limited: false };
}
