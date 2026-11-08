export interface ProjectKeywordChip { kind: 'keyword'; key: string; label: string }

/** Project keywords remain a separate kind; they never become template dimension options. */
export function withProjectKeywords<T extends { key: string; label: string }>(structured: T[], keywords: string[]): Array<(T & { kind: 'structured' }) | ProjectKeywordChip> {
  const seen = new Set<string>();
  const terms = keywords.flatMap(term => {
    const label = term.trim(), id = label.toLocaleLowerCase();
    if (!label || seen.has(id)) return [];
    seen.add(id); return [{ kind: 'keyword' as const, key: 'keyword:' + id, label }];
  });
  return [...terms.filter(term => term.label.toLocaleLowerCase() === 'aisec'), ...structured.map(term => ({ ...term, kind: 'structured' as const })), ...terms.filter(term => term.label.toLocaleLowerCase() !== 'aisec')];
}
