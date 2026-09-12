/* ---------- one search result set, fetched at most once ----------
   Three jobs — remember, dedupe, cancel — in one module because they share a key. Public reads
   only: entries are keyed by the query alone. Both rules: docs/system/cross-cutting.md */

const DEFAULT_MAX = 30;
const DEFAULT_TTL = 60_000;

/**
 * `max` is sized for a session's worth of refinements, not a catalogue: this is a latency cache,
 * not storage. `ttl` bounds staleness; anything that must be current reads with `{ fresh: true }`.
 */
export function createSearchCache({ max = DEFAULT_MAX, ttl = DEFAULT_TTL } = {}) {
  /** Settled values. Map iteration order is insertion order, which is what makes the LRU work. */
  const entries = new Map();
  /** Reads currently in flight, by key. Never holds a settled promise — see the `finally` below. */
  const inflight = new Map();

  function remember(key, value) {
    entries.set(key, { at: Date.now(), value });
    // One eviction per insert is enough to hold the bound, because the bound can only be exceeded
    // by one insert at a time.
    if (entries.size > max) entries.delete(entries.keys().next().value);
  }

  function recall(key) {
    const hit = entries.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > ttl) { entries.delete(key); return undefined; }
    // Re-insert to move it to the end: "least recently used", not "oldest". A set the user keeps
    // coming back to should outlive one they visited once and left.
    entries.delete(key);
    entries.set(key, hit);
    return hit;
  }

  /**
   * Read `key`, fetching only if it is neither remembered nor already being fetched. `key` must
   * include everything that changes the answer; the fetcher must forward the signal it is handed.
   */
  function read(key, fetcher, { signal, fresh = false } = {}) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (!fresh) {
      const hit = recall(key);
      // Resolved, not returned directly: a caller that awaits must never observe a hit
      // *synchronously* when a miss would have been a microtask later.
      if (hit) return Promise.resolve(hit.value);
    }

    let flight = inflight.get(key);
    if (!flight) {
      const ctl = new AbortController();
      flight = { ctl, subscribers: 0, promise: null };
      flight.promise = fetcher(ctl.signal)
        .then((value) => { remember(key, value); return value; })
        .finally(() => { if (inflight.get(key) === flight) inflight.delete(key); });
      inflight.set(key, flight);
    }

    flight.subscribers += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      flight.subscribers -= 1;
      if (flight.subscribers > 0) return;
      /* The last one out cancels, and retires the flight synchronously in the same breath — an
         already-doomed entry left in `inflight` is what strands StrictMode's second effect run. */
      if (inflight.get(key) === flight) inflight.delete(key);
      flight.ctl.abort();
    };

    return new Promise((resolve, reject) => {
      const onAbort = () => { release(); reject(abortError()); };
      signal?.addEventListener('abort', onAbort, { once: true });
      flight.promise.then(resolve, reject).finally(() => {
        signal?.removeEventListener('abort', onAbort);
        release();
      });
    });
  }

  return {
    read,
    /** Forget everything. For a mutation that invalidates unknowably much — a new listing, a sign-out. */
    clear: () => { entries.clear(); },
  };
}

/**
 * The rejection a caller sees when its own signal fired. Named `AbortError` so it is
 * indistinguishable from the platform's, keeping `http.isAbort` the single test every caller uses.
 */
function abortError() {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}
