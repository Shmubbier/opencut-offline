import type { FontAtlas } from "@/fonts/types";
import { SYSTEM_FONTS } from "@/fonts/system-fonts";

const FONT_ATLAS_PATH = "/fonts/font-atlas.json";
const FONT_CHUNK_PATH_PREFIX = "/fonts/font-chunk-";

const fullLoaded = new Set<string>();
const injectedCss = new Map<string, Promise<void>>();

let cachedAtlas: FontAtlas | null = null;
let atlasFetchPromise: Promise<FontAtlas | null> | null = null;

type LocalFontManifestEntry = { family: string; slug: string; cssPath: string };
let localFontManifest: Map<string, LocalFontManifestEntry> | null = null;
let localFontManifestPromise: Promise<Map<string, LocalFontManifestEntry>> | null = null;

const slugify = (family: string): string => family.toLowerCase().replace(/\s+/g, "-");

function loadLocalFontManifest(): Promise<Map<string, LocalFontManifestEntry>> {
	if (localFontManifest) return Promise.resolve(localFontManifest);
	if (localFontManifestPromise) return localFontManifestPromise;

	localFontManifestPromise = fetch("/fonts/local/manifest.json")
		.then(async (response) => {
			const map = new Map<string, LocalFontManifestEntry>();
			if (response.ok) {
				const data: { families: LocalFontManifestEntry[] } = await response.json();
				for (const entry of data.families) {
					map.set(entry.family.toLowerCase(), entry);
					map.set(entry.slug, entry);
				}
			}
			localFontManifest = map;
			return map;
		})
		.catch(() => {
			const map = new Map<string, LocalFontManifestEntry>();
			localFontManifest = map;
			return map;
		});

	return localFontManifestPromise;
}

function injectLocalFontCss(entry: LocalFontManifestEntry): Promise<void> {
	const existing = injectedCss.get(entry.slug);
	if (existing) return existing;

	const promise = new Promise<void>((resolve) => {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = entry.cssPath;
		link.addEventListener("load", () => resolve());
		link.addEventListener("error", () => resolve());
		document.head.appendChild(link);
	});
	injectedCss.set(entry.slug, promise);
	return promise;
}

export function getCachedFontAtlas(): FontAtlas | null {
	return cachedAtlas;
}

export function clearFontAtlasCache(): void {
	cachedAtlas = null;
	atlasFetchPromise = null;
	fullLoaded.clear();
	injectedCss.clear();
}

export function loadFontAtlas(): Promise<FontAtlas | null> {
	if (cachedAtlas) return Promise.resolve(cachedAtlas);
	if (atlasFetchPromise) return atlasFetchPromise;

	atlasFetchPromise = fetch(FONT_ATLAS_PATH)
		.then(async (response) => {
			if (!response.ok) return null;
			const data: FontAtlas = await response.json();
			cachedAtlas = data;
			preloadChunkImages({ atlas: data });
			return data;
		})
		.catch(() => null);

	return atlasFetchPromise;
}

function preloadChunkImages({ atlas }: { atlas: FontAtlas }): void {
	const maxChunk = Math.max(
		...Object.values(atlas.fonts).map((entry) => entry.ch),
	);
	for (let i = 0; i <= maxChunk; i++) {
		// hint browser to preload chunk images without blocking
		const img = new Image();
		img.src = `${FONT_CHUNK_PATH_PREFIX}${i}.avif`;
	}
}

export async function loadFullFont({
	family,
	weights = [400, 700],
}: {
	family: string;
	weights?: number[];
}): Promise<void> {
	if (fullLoaded.has(family)) return;

	// Offline build: no remote Google Fonts API fetch, ever. If this family
	// is one of the curated set self-hosted under public/fonts/local (see
	// scripts/fetch-fonts.mjs), inject its local @font-face CSS once. Otherwise
	// fall back to resolving whatever's already available locally (system fonts
	// / bundled atlas fonts).
	const manifest = await loadLocalFontManifest();
	const entry = manifest.get(family.toLowerCase()) ?? manifest.get(slugify(family));
	if (entry) await injectLocalFontCss(entry);

	await Promise.all(
		weights.map((weight) =>
			document.fonts.load(`${weight} 16px "${family.replace(/"/g, '\\"')}"`),
		),
	);
	fullLoaded.add(family);
}

export async function loadFonts({
	families,
}: {
	families: string[];
}): Promise<void> {
	const googleFonts = families.filter((family) => !SYSTEM_FONTS.has(family));
	await Promise.all(googleFonts.map((family) => loadFullFont({ family })));
}
