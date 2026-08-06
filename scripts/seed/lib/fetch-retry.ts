/** Fetches JSON with retries -- the free-tier card APIs 500 under sustained
 * load, especially PokemonTCG's unauthenticated tier, which rate-limits. */
export async function fetchJson<T>(url: string, init?: RequestInit, retries = 6): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        throw new Error(`${url} -> ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = Math.min(500 * 2 ** attempt, 15000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
