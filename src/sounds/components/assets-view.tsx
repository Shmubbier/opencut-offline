"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSoundsStore } from "@/sounds/sounds-store";
import type { SavedSound, SoundEffect } from "@/sounds/types";
import {
	CloudUploadIcon,
	FavouriteIcon,
	PauseIcon,
	PlayIcon,
	PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/** Shared zero/default shape for fields Freesound would normally supply. */
function blankSoundEffectFields() {
	return {
		description: "",
		filesize: 0,
		type: "audio",
		channels: 0,
		bitrate: 0,
		bitdepth: 0,
		samplerate: 0,
		tags: [] as string[],
		license: "CC0",
		created: new Date().toISOString(),
		downloads: 0,
		rating: 0,
		ratingCount: 0,
	};
}

/** Small hook: single-audio-element play/pause state, shared by both tabs. */
function useSoundPlayback() {
	const [playingId, setPlayingId] = useState<number | null>(null);
	const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(
		null,
	);

	const playSound = ({ sound }: { sound: SoundEffect }) => {
		if (playingId === sound.id) {
			audioElement?.pause();
			setPlayingId(null);
			return;
		}

		audioElement?.pause();

		if (sound.previewUrl) {
			const audio = new Audio(sound.previewUrl);
			audio.addEventListener("ended", () => {
				setPlayingId(null);
			});
			audio.addEventListener("error", () => {
				setPlayingId(null);
			});
			audio.play().catch((error) => {
				console.error("Failed to play sound preview:", error);
				setPlayingId(null);
			});

			setAudioElement(audio);
			setPlayingId(sound.id);
		}
	};

	return { playingId, playSound };
}

export function SoundsView() {
	return (
		<div className="flex h-full flex-col">
			<Tabs defaultValue="sound-effects" className="flex h-full flex-col">
				<div className="px-3 pt-4 pb-0">
					<TabsList>
						<TabsTrigger value="sound-effects">Sound effects</TabsTrigger>
						<TabsTrigger value="saved">Saved</TabsTrigger>
					</TabsList>
				</div>
				<Separator className="my-4" />
				<TabsContent
					value="sound-effects"
					className="mt-0 flex min-h-0 flex-1 flex-col p-5 pt-0"
				>
					<SoundEffectsView />
				</TabsContent>
				<TabsContent
					value="saved"
					className="mt-0 flex min-h-0 flex-1 flex-col p-5 pt-0"
				>
					<SavedSoundsView />
				</TabsContent>
			</Tabs>
		</div>
	);
}

interface SfxManifestEntry {
	id: number;
	name: string;
	file: string;
	duration: number;
}

// Negative, monotonically-decreasing ids for imported sounds — keeps them out
// of the bundled pack's id space (1..N) and collision-proof even when several
// files are picked within the same millisecond (unlike Date.now()-based ids).
let importIdCounter = -1;

function SoundEffectsView() {
	const { playingId, playSound } = useSoundPlayback();
	const [pack, setPack] = useState<SoundEffect[]>([]);
	const [packError, setPackError] = useState<string | null>(null);
	// ponytail: imported sounds are session-scoped (object URLs die on reload/
	// restart) — persisting them (e.g. IndexedDB) is a follow-up if users need
	// imports to survive across sessions.
	const [imported, setImported] = useState<SoundEffect[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);
	// Object URLs are only valid for this session — revoked below on unmount.
	const importedUrlsRef = useRef<string[]>([]);

	useEffect(() => {
		let cancelled = false;

		fetch("/sfx/manifest.json")
			.then((res) => {
				if (!res.ok) throw new Error(`Failed to load sound pack (${res.status})`);
				return res.json();
			})
			.then((manifest: { sounds: SfxManifestEntry[] }) => {
				if (cancelled) return;
				setPack(
					manifest.sounds.map((entry) => ({
						id: entry.id,
						name: entry.name,
						url: "",
						previewUrl: `/sfx/${entry.file}`,
						downloadUrl: `/sfx/${entry.file}`,
						duration: entry.duration,
						username: "Built-in",
						...blankSoundEffectFields(),
					})),
				);
			})
			.catch((error) => {
				if (!cancelled) setPackError(String(error));
			});

		return () => {
			cancelled = true;
		};
	}, []);

	// Best-effort cleanup: revoke every object URL we've handed out.
	useEffect(() => {
		return () => {
			for (const url of importedUrlsRef.current) URL.revokeObjectURL(url);
		};
	}, []);

	const handleFilesSelected = (files: FileList | null) => {
		if (!files || files.length === 0) return;

		const newItems: SoundEffect[] = Array.from(files).map((file) => {
			const objectUrl = URL.createObjectURL(file);
			importedUrlsRef.current.push(objectUrl);
			const id = importIdCounter--;

			// Probe the real duration so addSoundToTimeline (which sizes the
			// timeline element from sound.duration, not the decoded buffer)
			// doesn't create a zero-length clip. Backfill once metadata loads.
			const probe = new Audio(objectUrl);
			probe.addEventListener("loadedmetadata", () => {
				setImported((prev) =>
					prev.map((it) =>
						it.id === id ? { ...it, duration: probe.duration || 0 } : it,
					),
				);
			});

			return {
				id,
				name: file.name,
				url: "",
				previewUrl: objectUrl,
				downloadUrl: objectUrl,
				duration: 0,
				username: "Imported",
				...blankSoundEffectFields(),
			};
		});

		setImported((prev) => [...newItems, ...prev]);
	};

	return (
		<div className="mt-1 flex h-full flex-col gap-4">
			<div>
				<input
					ref={fileInputRef}
					type="file"
					accept="audio/*"
					multiple
					className="hidden"
					onChange={(e) => {
						handleFilesSelected(e.target.files);
						e.target.value = "";
					}}
				/>
				<Button
					variant="outline"
					size="sm"
					className="w-full"
					onClick={() => fileInputRef.current?.click()}
				>
					<HugeiconsIcon icon={CloudUploadIcon} className="size-4" />
					Import audio files
				</Button>
			</div>

			<div className="relative h-full overflow-hidden">
				<ScrollArea className="h-full flex-1">
					<div className="flex flex-col gap-4">
						{imported.length > 0 && (
							<>
								<p className="text-muted-foreground text-xs font-medium">
									Imported ({imported.length})
								</p>
								{imported.map((sound) => (
									<AudioItem
										key={sound.id}
										sound={sound}
										isPlaying={playingId === sound.id}
										onPlay={playSound}
										allowSave={false}
									/>
								))}
								<Separator />
							</>
						)}

						<p className="text-muted-foreground text-xs font-medium">
							Sound effects
						</p>
						{packError && (
							<p className="text-destructive text-sm">{packError}</p>
						)}
						{pack.map((sound) => (
							<AudioItem
								key={sound.id}
								sound={sound}
								isPlaying={playingId === sound.id}
								onPlay={playSound}
							/>
						))}
					</div>
				</ScrollArea>
			</div>
		</div>
	);
}

function SavedSoundsView() {
	const {
		savedSounds,
		isLoadingSavedSounds,
		savedSoundsError,
		loadSavedSounds,
		clearSavedSounds,
	} = useSoundsStore();

	const { playingId, playSound } = useSoundPlayback();

	const [showClearDialog, setShowClearDialog] = useState(false);

	useEffect(() => {
		loadSavedSounds();
	}, [loadSavedSounds]);

	const convertToSoundEffect = ({
		savedSound,
	}: {
		savedSound: SavedSound;
	}): SoundEffect => ({
		id: savedSound.id,
		name: savedSound.name,
		description: "",
		url: "",
		previewUrl: savedSound.previewUrl,
		downloadUrl: savedSound.downloadUrl,
		duration: savedSound.duration,
		filesize: 0,
		type: "audio",
		channels: 0,
		bitrate: 0,
		bitdepth: 0,
		samplerate: 0,
		username: savedSound.username,
		tags: savedSound.tags,
		license: savedSound.license,
		created: savedSound.savedAt,
		downloads: 0,
		rating: 0,
		ratingCount: 0,
	});

	if (isLoadingSavedSounds) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-muted-foreground text-sm">
					Loading saved sounds...
				</div>
			</div>
		);
	}

	if (savedSoundsError) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-destructive text-sm">
					Error: {savedSoundsError}
				</div>
			</div>
		);
	}

	if (savedSounds.length === 0) {
		return (
			<div className="bg-background flex h-full flex-col items-center justify-center gap-3 p-4">
				<HugeiconsIcon
					icon={FavouriteIcon}
					className="text-muted-foreground size-10"
				/>
				<div className="flex flex-col gap-2 text-center">
					<p className="text-lg font-medium">No saved sounds</p>
					<p className="text-muted-foreground text-sm text-balance">
						Click the heart icon on any sound to save it here
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="mt-1 flex h-full flex-col gap-5">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">
					{savedSounds.length} saved{" "}
					{savedSounds.length === 1 ? "sound" : "sounds"}
				</p>
				<Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
					<DialogTrigger asChild>
						<Button
							variant="text"
							size="sm"
							className="text-muted-foreground hover:text-destructive h-auto !opacity-100"
						>
							Clear all
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Clear all saved sounds?</DialogTitle>
							<DialogDescription>
								This will permanently remove all {savedSounds.length} saved
								sounds from your collection. This action cannot be undone.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="text" onClick={() => setShowClearDialog(false)}>
								Cancel
							</Button>
							<Button
								variant="destructive"
								onClick={async ({
									stopPropagation,
								}: React.MouseEvent<HTMLButtonElement>) => {
									stopPropagation();
									await clearSavedSounds();
									setShowClearDialog(false);
								}}
							>
								Clear all sounds
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>

			<div className="relative h-full overflow-hidden">
				<ScrollArea className="h-full flex-1">
					<div className="flex flex-col gap-4">
						{savedSounds.map((sound) => (
							<AudioItem
								key={sound.id}
								sound={convertToSoundEffect({ savedSound: sound })}
								isPlaying={playingId === sound.id}
								onPlay={playSound}
							/>
						))}
					</div>
				</ScrollArea>
			</div>
		</div>
	);
}

/**
 * Resolves a sound's real duration from its audio URL. Used as a safety net
 * when a SoundEffect reaches "add to timeline" before its duration has been
 * backfilled (e.g. an import clicked before `loadedmetadata` fires) — without
 * this, addSoundToTimeline would size the clip from a stale duration of 0.
 */
function probeAudioDuration(url: string): Promise<number> {
	return new Promise((resolve) => {
		const audio = new Audio(url);
		const cleanup = () => {
			audio.removeEventListener("loadedmetadata", onLoaded);
			audio.removeEventListener("error", onError);
		};
		const onLoaded = () => {
			cleanup();
			resolve(audio.duration || 0);
		};
		const onError = () => {
			cleanup();
			resolve(0);
		};
		audio.addEventListener("loadedmetadata", onLoaded);
		audio.addEventListener("error", onError);
	});
}

interface AudioItemProps {
	sound: SoundEffect;
	isPlaying: boolean;
	onPlay: ({ sound }: { sound: SoundEffect }) => void;
	/** Session-only sounds (blob: URLs) can't be saved — their URL won't
	 * survive a reload, leaving a broken entry in the persistent Saved store.
	 * Defaults to true (bundled pack + already-saved sounds are safe to save). */
	allowSave?: boolean;
}

function AudioItem({ sound, isPlaying, onPlay, allowSave = true }: AudioItemProps) {
	const { addSoundToTimeline, isSoundSaved, toggleSavedSound } =
		useSoundsStore();
	const isSaved = isSoundSaved({ soundId: sound.id });

	const handleClick = () => {
		onPlay({ sound });
	};

	const handleSaveClick = ({
		stopPropagation,
	}: React.MouseEvent<HTMLButtonElement>) => {
		stopPropagation();
		toggleSavedSound({ soundEffect: sound });
	};

	const handleAddToTimeline = async ({
		stopPropagation,
	}: React.MouseEvent<HTMLButtonElement>) => {
		stopPropagation();
		// Safety net: duration may not have been backfilled yet (see
		// SoundEffectsView's loadedmetadata probe) — resolve it on demand so
		// addSoundToTimeline never sizes the clip from a stale 0.
		if (!sound.duration && sound.previewUrl) {
			const duration = await probeAudioDuration(sound.previewUrl);
			await addSoundToTimeline({ sound: { ...sound, duration } });
			return;
		}
		await addSoundToTimeline({ sound });
	};

	return (
		<div className="group flex items-center gap-3 opacity-100 hover:opacity-75">
			<button
				type="button"
				className="flex min-w-0 flex-1 items-center gap-3 text-left"
				onClick={handleClick}
			>
				<div className="bg-accent relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
					<div className="from-primary/20 absolute inset-0 bg-gradient-to-br to-transparent" />
					{isPlaying ? (
						<HugeiconsIcon icon={PauseIcon} className="size-5" />
					) : (
						<HugeiconsIcon icon={PlayIcon} className="size-5" />
					)}
				</div>

				<div className="min-w-0 flex-1 overflow-hidden">
					<p className="truncate text-sm font-medium">{sound.name}</p>
					<span className="text-muted-foreground block truncate text-xs">
						{sound.username}
					</span>
				</div>
			</button>

			<div className="flex items-center gap-3 pr-2">
				<Button
					variant="text"
					size="icon"
					className="text-muted-foreground hover:text-foreground w-auto !opacity-100"
					onClick={handleAddToTimeline}
					title="Add to timeline"
				>
					<HugeiconsIcon icon={PlusSignIcon} />
				</Button>
				{allowSave && (
					<Button
						variant="text"
						size="icon"
						className={`hover:text-foreground w-auto !opacity-100 ${
							isSaved
								? "text-red-500 hover:text-red-600"
								: "text-muted-foreground"
						}`}
						onClick={handleSaveClick}
						title={isSaved ? "Remove from saved" : "Save sound"}
					>
						<HugeiconsIcon
							icon={FavouriteIcon}
							className={`${isSaved ? "fill-current" : ""}`}
						/>
					</Button>
				)}
			</div>
		</div>
	);
}
