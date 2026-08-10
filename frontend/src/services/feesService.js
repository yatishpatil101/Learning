/**
 * Fees Service — the published cost of transacting, one breakdown per deal intent.
 *
 * `GET /fees` (public).
 *
 * ## Why this domain exists
 *
 * The rent-agreement wizard used to price itself: stamp duty from the Maharashtra Art. 36A formula,
 * registration from a ₹500/₹1000 rule, service fee from the mock back-office panel. The server bills
 * from its `platform_fees('rent')` row — `platformFee + stampDuty + registration + gst` — so two
 * pieces of code computed a price from two different data sources and agreed only by coincidence
 * (D9, D150). A checkout that meets a different number than the sidebar promised is not a rounding
 * bug; it is the customer being quoted one price and charged another.
 *
 * So the sidebar reads *this*, and the figure it shows is the figure the server adds up. Nothing
 * about that is a coincidence any more.
 *
 * ## Shape
 *
 *   { deal, brokerage, platformFee, stampDuty, registration, gst, notes }
 *
 * Every figure is whole rupees, mirroring the contract's `Fees` schema (`Money` is `int64`) — never
 * a float, never a formatted string.
 *
 * **A `null` figure means "not published", not "zero".** The server's columns are all `NOT NULL`, so
 * a null can only ever come from the mock provider, which has no statutory schedule to publish. A
 * consumer that meets one has to decide what to do about it out loud — see the `computed` list the
 * rent-agreement cost estimate carries — rather than silently rendering ₹0 as though the government
 * had waived the duty.
 */
import { createProvider } from './config.js';

const provider = createProvider('fees');

/**
 * Every published breakdown, one per deal intent.
 *
 * **Public** — this is the zero-brokerage claim in numbers, and it has to render for the signed-out
 * visitor it exists to convince. No token, no short-circuit on a missing session.
 *
 * @returns {Promise<{deal: string, brokerage: number, platformFee: number, stampDuty: (number|null),
 *   registration: (number|null), gst: number, notes: (string|null)}[]>}
 */
export const listFees = () => provider().listFees();

/**
 * The breakdown for one deal intent, or `null` when nothing is published for it.
 *
 * Derived here rather than in each provider: the endpoint returns the whole (two-row) table in one
 * response, so a per-deal provider method would be a second request for data the first one already
 * carried. `null` is the honest answer for an unpublished deal — the caller has to render a pending
 * or unavailable state, and giving it a fabricated all-zero row instead would hand it a confident
 * wrong number, which is the failure this whole domain was created to remove.
 *
 * @param {string} deal `rent` | `buy`
 */
export const getDealFees = async (deal) => {
  const rows = await listFees();
  return (Array.isArray(rows) ? rows : []).find((f) => f.deal === deal) || null;
};
