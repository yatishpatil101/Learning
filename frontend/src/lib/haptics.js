/* Haptic feedback.
 *
 * A 10ms tick on a state change the eye can miss — a heart filling, a wizard step
 * advancing — is most of what separates an app that feels native from a web page
 * that happens to be on a phone. It is also the cheapest such signal available:
 * one Web API, no dependency, no layout, no render.
 *
 * Scope and honesty about support:
 *   · Android Chrome / Samsung Internet / Firefox Android implement it. India is
 *     ~95% Android, so this covers nearly the whole target audience.
 *   · iOS Safari does NOT implement navigator.vibrate, in any browser on the
 *     platform (they are all WebKit). iOS users get nothing here, and there is no
 *     web workaround — the only route is the Capacitor Haptics plugin, which
 *     arrives with the packaging phase in docs/roadmap/mobile-app-plan.md. Calling
 *     this on iOS is a silent no-op, which is the correct behaviour, not a bug.
 *
 * Consent: vibration is motion, and a user who asked for less motion means it
 * physically as well as visually. Both the OS-level `prefers-reduced-motion` and
 * the app's own "Reduce motion" toggle suppress it — no third setting, because a
 * separate haptics switch would be one more thing to find and would disagree with
 * the two that already exist.
 */
// Imported from the owning module, not the store.js barrel: the barrel re-exports
// a dozen domains, and pulling all of them in to read one boolean would put the
// whole store graph behind every component that wants a tick.
import { getAppPrefs } from './localPrefs.js';

/** Durations in ms. Short enough to read as a tick, never as a buzz. */
const PATTERN = {
  /** A state you toggled: save, follow, select. */
  tick: 10,
  /** A step completed: wizard advance, form submitted. Two beats reads as progress. */
  step: [10, 40, 10],
};

function suppressed() {
  if (typeof window === 'undefined') return true;
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    if (getAppPrefs().reduceMotion) return true;
  } catch {
    // A pref lookup must never be the reason an interaction fails.
    return true;
  }
  return false;
}

/**
 * Fire a haptic tick. No-op where unsupported or where the user asked for less
 * motion. Never throws — a decorative signal must not be able to break a handler.
 *
 * @param {'tick'|'step'} [kind='tick']
 */
export function haptic(kind = 'tick') {
  if (suppressed()) return;
  // Feature-detect on the function, not on the vendor: some browsers expose
  // `vibrate` but reject the call outside a user gesture, which throws.
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(PATTERN[kind] ?? PATTERN.tick);
  } catch { /* unsupported, blocked, or not in a gesture — all fine to ignore */ }
}
