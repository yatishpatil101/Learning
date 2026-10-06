/** recordSignal never rejects: callers are search/property pages with no recovery, and a lost analytics
 * write beats one that breaks a search. Anonymous by design; no contact detail is sent. */
import { createProvider } from './config.js';

const provider = createProvider('demand');

export const recordSignal = async (signal) => {
  try {
    return await (await provider()).recordSignal(signal);
  } catch {
    // Swallowed on purpose (see module docblock); not logged, so flaky connections don't fill the console.
    return false;
  }
};

/** The supply-gap report (staff and admin). Unlike `recordSignal` it rejects, because a quiet failure would render as "no demand anywhere". */
export const supplyGap = async (opts) => (await provider()).supplyGap(opts);
