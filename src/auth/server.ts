// Offline stub: no auth backend. Always reports a logged-out session.

export const auth = {
	api: {
		getSession: async () => null,
	},
};

export type Auth = typeof auth;
