/** `POST /page-views` (public). Fire-and-forget: `recordPageViews` never rejects and resolves to nothing. Only route patterns, a referrer host and a
 * viewport bucket are sent, and `/admin*` / `/ops*` are dropped before queueing; the server re-applies those rules rather than trusting the client. */
import { createProvider } from './config.js';

const provider = createProvider('pageView');

/** Sends one flush of queued page views; never rejects. `attributed` is the analytics-consent choice, without which the server keeps the viewer unnamed. */
export const recordPageViews = async (batch) => {
  try {
    await (await provider()).recordPageViews(batch);
  } catch {
    // Swallowed and not logged: a route change has no recovery, and flaky connections would flood the console.
  }
};
