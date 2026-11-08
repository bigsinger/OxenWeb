import { watch, type WatchSource } from 'vue';

/** Only a different dataset context invalidates a loaded page; sample is local UI state. */
export function watchDatasetContext(
  sources: { base: WatchSource<string>; branch: WatchSource<string>; commit: WatchSource<unknown>; principal: WatchSource<string> },
  reset: () => void,
) {
  return watch([sources.base, sources.branch, sources.commit, sources.principal], reset, { immediate: true });
}

export function datasetSelectionAction(requested: unknown, selected: string, loadedIds: readonly string[]): 'none' | 'select' | 'locate' {
  if (typeof requested !== 'string' || !requested || requested === selected) return 'none';
  return loadedIds.includes(requested) ? 'select' : 'locate';
}
