/** Flush input entered during an awaited save before allowing its form to unmount. */
export async function persistStableForm(options: {
  generation: () => number;
  signature: () => string;
  persist: () => Promise<boolean>;
  settle?: () => Promise<unknown>;
}): Promise<boolean> {
  const generation = options.generation();
  while (generation === options.generation()) {
    const before = options.signature();
    if (!await options.persist()) return false;
    await options.settle?.();
    if (generation !== options.generation()) return false;
    // Compare raw input, not the stored baseline: deferred recovery may intentionally skip a write.
    if (before === options.signature()) return true;
  }
  return false;
}
