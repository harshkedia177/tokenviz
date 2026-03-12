const DEFAULT_CONCURRENCY = parseInt(process.env.BRAGGRID_CONCURRENCY ?? '', 10) || 4;

export async function poolMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<R[]> {
  const results: Promise<R>[] = [];
  const executing = new Set<Promise<R>>();
  for (const item of items) {
    const p: Promise<R> = fn(item).then(r => { executing.delete(p); return r; });
    executing.add(p);
    results.push(p);
    if (executing.size >= concurrency) await Promise.race(executing);
  }
  return Promise.all(results);
}
