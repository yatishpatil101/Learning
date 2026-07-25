/**
 * File-based persistence layer.
 *
 * In development (Vite dev server), user data is synced to JSON files on disk
 * via the vite-plugin-persist middleware. This means data survives:
 *   - Browser data/cache clears
 *   - Switching browsers
 *   - Machine restarts
 *
 * The persist files live in /data/persist/<key>.json and are gitignored.
 *
 * In production builds, this falls back to localStorage-only (no file API).
 *
 * Usage:
 *   import { persistSave, persistLoad } from './persist.js';
 *   await persistSave('puneNestDB_v1', dbObject);
 *   const db = await persistLoad('puneNestDB_v1');
 */

const IS_DEV = import.meta.env.DEV;
const PERSIST_BASE = '/api/__persist/';

/* Under automation (Playwright/Selenium set navigator.webdriver), skip all disk-cache
   I/O so every spec runs deterministically from the seed + its own addInitScript state.
   Without this, stale on-disk caches (userdata.json, puneNestDB_v*) hydrate into
   localStorage and silently inject state tests deliberately left unset — e.g. re-verifying
   an "unverified" buyer — which is real-user-irrelevant but breaks test isolation. */
const IS_AUTOMATED = typeof navigator !== 'undefined' && navigator.webdriver;
const DISK_OFF = !IS_DEV || IS_AUTOMATED;

/** Debounce map — prevents excessive writes for rapid mutations */
const timers = new Map();
const DEBOUNCE_MS = 800;

/**
 * Save data to a persistent JSON file (debounced).
 * Falls back to no-op in production (localStorage is the source of truth there).
 */
export function persistSave(key, data) {
  if (DISK_OFF) return;

  // Debounce: only write after 800ms of inactivity for this key
  if (timers.has(key)) clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    fetch(PERSIST_BASE + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => {
      // Silent fail — persist is best-effort in dev
    });
  }, DEBOUNCE_MS));
}

/**
 * Load data from the persistent JSON file.
 * Returns null if file doesn't exist.
 * Falls back to null in production.
 */
export async function persistLoad(key) {
  if (DISK_OFF) return null;

  try {
    const res = await fetch(PERSIST_BASE + key);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

/**
 * Force-flush a key immediately (no debounce). Use before page unload.
 */
export function persistFlush(key, data) {
  if (DISK_OFF) return;
  if (timers.has(key)) {
    clearTimeout(timers.get(key));
    timers.delete(key);
  }
  // Use sendBeacon for reliability during page unload
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  navigator.sendBeacon(PERSIST_BASE + key, blob);
}
