// Offline stub: the app runs with no backend, so auth is a permanent
// logged-out no-op. Export names match the real auth client shape that
// callers previously imported (signIn, signUp, useSession).

export function useSession() {
	return { data: null, isPending: false, error: null };
}

export async function signIn(): Promise<void> {
	// no-op: offline build has no auth backend
}

export async function signUp(): Promise<void> {
	// no-op: offline build has no auth backend
}
