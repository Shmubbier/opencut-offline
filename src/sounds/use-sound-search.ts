import { useSoundsStore } from "@/sounds/sounds-store";

// ponytail: offline build has no sound-search backend. This returns the
// store's (always-empty, never-populated) search state instead of fetching,
// so assets-view keeps its existing shape and shows an empty/offline result.
export function useSoundSearch({
	query,
	commercialOnly,
}: {
	query: string;
	commercialOnly: boolean;
}) {
	const { searchResults, isSearching, searchError, hasNextPage, isLoadingMore, totalCount } =
		useSoundsStore();

	const loadMore = async () => {};

	return {
		results: searchResults,
		isLoading: isSearching,
		error: searchError,
		loadMore,
		hasNextPage,
		isLoadingMore,
		totalCount,
	};
}
