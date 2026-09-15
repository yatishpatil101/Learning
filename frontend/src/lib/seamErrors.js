/**
 * Codes for failures the seam itself raises. Shared as a constant because a literal repeated in
 * three files drifts silently: no lint error, no failing test, just the wrong sentence.
 */

/**
 * Named for what the seam **observes**, not a cause it cannot establish: a dynamic import rejects
 * identically for a stale chunk, a dropped radio, a CDN 5xx and a syntax error.
 */
export const PROVIDER_LOAD_FAILED = 'provider_load_failed';

/**
 * `navigator.onLine` is trustworthy only in the negative, so it is used one way round: to
 * *withhold* the "reload, we updated" advice, never to assert it.
 */
export function isDefinitelyOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Set before the reload, read after it: a second attempt would be a loop, not a recovery. */
const RELOAD_ATTEMPTED = 'draazy:reloaded-for-stale-shell';

/**
 * A rejected dynamic import is memoised against its specifier, so the page is already dead and
 * nothing is lost by reloading it. Refused when offline, already tried, or sessionStorage throws.
 *
 * @returns {boolean} `true` when a reload has been started — the caller's message will not be read.
 */
export function healStaleShell(err) {
  if (err?.code !== PROVIDER_LOAD_FAILED || isDefinitelyOffline()) return false;
  try {
    if (sessionStorage.getItem(RELOAD_ATTEMPTED)) return false;
    sessionStorage.setItem(RELOAD_ATTEMPTED, '1');
  } catch {
    return false;
  }
  updateWorkerThenReload();
  return true;
}

/**
 * A bare reload is answered by the service worker out of the same precache that names the missing
 * chunk. Updating the registration first is what makes the reload worth doing.
 */
async function updateWorkerThenReload() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.update();
  } catch {
    /* No worker registered, or the update check failed. Reload regardless: with no worker in the
       way the navigation goes to the origin, which is the fresh shell we were after. */
  }
  window.location.reload();
}
