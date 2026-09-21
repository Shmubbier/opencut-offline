import { z } from "zod";

const webEnvSchema = z.object({
	// Node
	NODE_ENV: z.enum(["development", "production", "test"]),
	ANALYZE: z.string().optional(),
	NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),

	// Public
	NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
	NEXT_PUBLIC_MARBLE_API_URL: z.url().optional(),

	// Server
	DATABASE_URL: z.string().refine(
		(url) =>
			url.startsWith("postgres://") || url.startsWith("postgresql://"),
		"DATABASE_URL must be a postgres:// or postgresql:// URL",
	).optional(),

	BETTER_AUTH_SECRET: z.string().optional(),
	UPSTASH_REDIS_REST_URL: z.url().optional(),
	UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
	MARBLE_WORKSPACE_KEY: z.string().optional(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

const _parsed = webEnvSchema.safeParse(process.env);
export const webEnv: WebEnv = _parsed.success
	? _parsed.data
	: (webEnvSchema.parse({ NODE_ENV: process.env.NODE_ENV ?? "production" }));
