/** Commas/newlines separate searches; spaces within a role stay together. */
export function parseJobKeywords(value: string): string[] {
  const seen = new Set<string>();
  return value.split(/[,\n]+/).map((word) => word.trim()).filter((word) => {
    const key = word.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function searchEachKeyword<T extends { url: string }>(value: string, search: (keyword: string) => Promise<T[]>, concurrency = 2, onBatch?: (fresh: T[]) => Promise<void>): Promise<T[]> {
  const words = parseJobKeywords(value);
  const jobs = new Map<string, T>();
  const size = Math.max(1, Math.min(6, Math.floor(concurrency) || 1));
  for (let i = 0; i < words.length; i += size) {
    const batches = await Promise.all(words.slice(i, i + size).map((word) => search(word)));
    const fresh: T[] = [];
    for (const job of batches.flat()) if (!jobs.has(job.url)) { jobs.set(job.url, job); fresh.push(job); }
    if (onBatch && fresh.length) await onBatch(fresh);
  }
  return [...jobs.values()];
}