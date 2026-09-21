#!/usr/bin/env node
// Build-time fetcher for a curated set of Google Font families, self-hosted for
// offline use. Fetches woff2 (needs a desktop-Chrome UA or Google serves ttf),
// rewrites the CSS to local paths, and writes a manifest that
// src/fonts/google-fonts.ts reads at runtime. Not run during the app build —
// run manually when the curated list changes; the fetched assets are committed.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CURATED_FAMILIES = [
	"Roboto",
	"Open Sans",
	"Lato",
	"Montserrat",
	"Oswald",
	"Poppins",
	"Raleway",
	"Playfair Display",
	"Merriweather",
	"Nunito",
	"Bebas Neue",
	"Anton",
	"Lobster",
	"Pacifico",
	"Dancing Script",
	"Source Sans 3",
	"Work Sans",
	"Rubik",
	"Archivo",
	"Inter",
];

const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const OUT_DIR = path.join(process.cwd(), "public", "fonts", "local");

const slugify = (family) => family.toLowerCase().replace(/\s+/g, "-");

async function fetchCss(family, weightSpec) {
	const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:${weightSpec}&display=swap`;
	const res = await fetch(url, { headers: { "User-Agent": UA } });
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	return res.text();
}

async function fetchFamily(family) {
	const slug = slugify(family);
	let css;
	try {
		css = await fetchCss(family, "wght@400;700");
	} catch (err) {
		console.warn(`  400;700 failed for "${family}" (${err.message}), retrying with 400 only`);
		css = await fetchCss(family, "wght@400");
	}

	const urlRe = /url\((https:\/\/[^)]+?\.woff2)\)/g;
	const woff2Urls = [...css.matchAll(urlRe)].map((m) => m[1]);
	if (woff2Urls.length === 0) {
		throw new Error(`no woff2 urls found for "${family}"`);
	}

	const familyDir = path.join(OUT_DIR, slug);
	await mkdir(familyDir, { recursive: true });

	let rewritten = css;
	for (const [i, fileUrl] of woff2Urls.entries()) {
		const fileName = `${i}.woff2`;
		const res = await fetch(fileUrl, { headers: { "User-Agent": UA } });
		if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${fileUrl}`);
		const buf = Buffer.from(await res.arrayBuffer());
		await writeFile(path.join(familyDir, fileName), buf);
		rewritten = rewritten.replace(fileUrl, `/fonts/local/${slug}/${fileName}`);
	}

	const cssPath = `/fonts/local/${slug}.css`;
	await writeFile(path.join(OUT_DIR, `${slug}.css`), rewritten, "utf8");

	return { family, slug, cssPath, fileCount: woff2Urls.length };
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	const manifestFamilies = [];

	for (const family of CURATED_FAMILIES) {
		process.stdout.write(`Fetching "${family}"... `);
		try {
			const entry = await fetchFamily(family);
			manifestFamilies.push({
				family: entry.family,
				slug: entry.slug,
				cssPath: entry.cssPath,
			});
			console.log(`ok (${entry.fileCount} files)`);
		} catch (err) {
			console.warn(`SKIPPED: ${err.message}`);
		}
		// be polite to Google Fonts
		await new Promise((resolve) => setTimeout(resolve, 250));
	}

	if (manifestFamilies.length === 0) {
		throw new Error("no families fetched successfully — aborting manifest write");
	}

	await writeFile(
		path.join(OUT_DIR, "manifest.json"),
		JSON.stringify({ families: manifestFamilies }, null, 2),
		"utf8",
	);

	console.log(`\nDone. ${manifestFamilies.length}/${CURATED_FAMILIES.length} families bundled.`);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
