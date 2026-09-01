/**
 * Mock demand provider — the localStorage counterpart to `providers/http/demandProvider.js`.
 *
 * This is the seam's memorial to how the report used to work. Every signal written here lands in
 * one browser's storage and is read back by the same browser, which is exactly why the live
 * provider exists: demand only means something when it aggregates across everybody.
 *
 * Kept anyway, because mock mode is how the app is demoed with no backend running, and a Supply Gap
 * tab that threw would be worse than one that reports a single session honestly.
 */
import { logSearchIntent, addDemandAlert, logPropertyView } from '../../../lib/mockApi.js';
import { localities, supplyDemandGap } from '../../../lib/data/analytics-extra.js';

/**
 * Slug to display name, because the localStorage aggregation is keyed on the name a mock listing
 * carries while the wire body carries a slug.
 *
 * This shim exists only on this side of the seam. The server joins `demand_signals.locality_slug`
 * to `localities.slug` and resolves the name itself, which is why the callers were changed to send
 * slugs — a demand table keyed on whatever the label happened to be that day cannot be joined to
 * anything.
 */
const displayName = (slug) => {
  if (!slug) return '';
  const match = (localities() || []).find((l) => l.slug === slug);
  return match?.name || slug;
};

/**
 * Dispatch by kind onto the three mock writers that survived the migration.
 *
 * The mock's own shapes differ from the wire body — `locality` rather than `localitySlug`, a free
 * `budget` field, a `mobile` on the alert — and none of that is bridged here beyond the fields the
 * server accepts. Feeding the mock a richer record than the server can store would let a page start
 * depending on data that vanishes the day the domain goes live.
 */
export async function recordSignal(signal) {
  const locality = displayName(signal?.localitySlug);
  switch (signal?.kind) {
    case 'search':
      logSearchIntent({ locality, deal: signal?.deal, bhk: signal?.bhk });
      return true;
    case 'alert':
      await addDemandAlert({ locality, deal: signal?.deal, bhk: signal?.bhk });
      return true;
    case 'view':
      logPropertyView(locality, signal?.propertyId);
      return true;
    default:
      // The server answers 422 here. The mock cannot, because nothing awaits the result, so the
      // signal is dropped and the caller carries on -- the same outcome, one status code short.
      return false;
  }
}

/**
 * The mock rows are keyed on a locality's display *name*, because that is what the mock listings
 * carry. The server keys on slug and resolves the name for display, so both fields are populated
 * here and the tab can read the same two properties in either mode.
 *
 * `days` is accepted and ignored: the mock aggregation has its own hard-coded 30-day cutoff inside
 * `supplyDemandGap`, and inventing a second window here would make the control look functional.
 */
export async function supplyGap() {
  return supplyDemandGap().map((r) => ({
    localitySlug: r.slug ?? null,
    localityName: r.name ?? null,
    supply: Number(r.supply) || 0,
    searches: Number(r.searches) || 0,
    alerts: Number(r.alerts) || 0,
    views: Number(r.views) || 0,
    repeatSeekers: Number(r.hot) || 0,
    demand: Number(r.demand) || 0,
    gap: Number(r.gap) || 0,
  }));
}
