/**
 * Mock fees provider — the localStorage counterpart to `providers/http/feesProvider.js`.
 *
 * The mock's source of truth for what the platform charges is the back-office Fees panel
 * (`lib/store/billing.js` → `getFees()`, editable at runtime from admin Settings → Charges), so the
 * platform fee is read from there rather than from a constant. That mirrors how the plan domain
 * works, and for the same reason: reading a constant would make the page disagree with the panel
 * that sets it.
 *
 * ## Two deliberate differences from the server, both documented rather than papered over
 *
 * **`stampDuty` and `registration` are `null`, not `0`.** There is no mock statutory schedule — the
 * back-office panel has never held one — and publishing `0` would tell the rent-agreement sidebar
 * that Maharashtra had waived the duty. `null` means "not published", and the sidebar's cost
 * estimate answers it by deriving the two locally from the Art. 36A formula and listing them as
 * computed. Against the live API both arrive as real numbers (today `0`, because the seed has not
 * been given the real figures yet — a backend data gap, not a client one) and nothing is derived.
 *
 * **`gst` is `0`.** The panel carries a `gstPercent`, but the mock has never added tax to this
 * estimate and the existing mock expectation is `service + statutory` exactly. Charging GST here
 * would change a number no mock code path can settle, so the mock stays as it always billed and the
 * server stays authoritative for what tax is actually due.
 *
 * Only the `rent` row is published. The `buy` breakdown has no mock source at all — inventing one
 * would be a fabricated price with nothing behind it, and `getDealFees('buy')` correctly resolving
 * to `null` is the honest answer.
 */
import { getFees } from '../../../lib/store.js';

/** The published breakdowns the mock can honestly answer for. */
export async function listFees() {
  const panel = getFees();
  return [
    {
      deal: 'rent',
      brokerage: 0,
      platformFee: Number(panel?.rentAgreementPlatform) || 0,
      stampDuty: null,
      registration: null,
      gst: 0,
      notes: null,
    },
  ];
}
