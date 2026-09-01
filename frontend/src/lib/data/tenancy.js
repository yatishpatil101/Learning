/* Tenant-side "My Rental" presentation helpers.

   The tenancy itself now comes from the server (`rentService.myTenancies`), which answers with the
   rows the tenant is named on. What is left here is the shaping the hub needs on top of that: the
   card defaults a lean record does not carry, and the rent status derived from the tenant's own
   payment history.

   The demo seeder that used to live here is gone. It wrote a tenancy, a payout account, two
   payments, an agreement and a tenant profile straight into localStorage — a fixture that the
   server has no way to produce, and one that made the hub look populated while the account behind
   it was empty. The seeded e2e tenant covers the same ground against real rows. */

import { digits } from '../contact.js';
import { thisMonth } from '../rentPay.js';
import { getPropertiesByIds } from '../../services/propertyService.js';

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=80';

/**
 * The day of the month rent falls due.
 *
 * There is no `dueDay` on the wire and no column behind one: nothing in the product asks a tenant
 * or an owner what day they settled on. So it is derived from the day the lease started, which is
 * the convention a monthly tenancy actually follows — a lease beginning on the 3rd bills on the
 * 3rd. That is a fact the record carries, unlike the flat `5` this used to assume, which was wrong
 * for twenty-nine days out of thirty and drove the "next due" date the hub displays.
 *
 * Days past the 28th are clamped so a lease starting on the 31st does not silently skip February.
 */
function dueDayFromLease(startDate) {
  if (!startDate) return 1;
  const day = Number(String(startDate).slice(8, 10));
  if (!Number.isFinite(day) || day < 1) return 1;
  return Math.min(day, 28);
}

/**
 * A server tenancy → the shape the My Rental card draws.
 *
 * The server owns the money, the dates and the parties; everything added here is presentation the
 * wire has no opinion about (a placeholder photo, a human label for a missing landlord name). The
 * property's own title and address are not on `TenancyDto`, so a caller that has the listing should
 * pass it in rather than have this invent one.
 *
 * @param {object} row a `rentService.myTenancies()` row
 * @param {object} [listing] the matching property, when the caller has already loaded it
 */
export function toRentalCard(row, listing) {
  const startDate = row?.startDate || '';
  return {
    id: row?.id || '',
    propId: row?.propId || row?.propertyId || '',
    title: listing?.title || 'Rented home',
    address: listing?.address || listing?.locality || 'Pune',
    locality: listing?.locality || '',
    bhk: listing?.bhk || '',
    image: listing?.image || listing?.img || FALLBACK_IMAGE,
    ownerName: row?.ownerName || 'Your landlord',
    ownerMobile: digits(row?.ownerMobile || ''),
    rent: Number(row?.rent) || 0,
    deposit: Number(row?.deposit) || 0,
    dueDay: dueDayFromLease(startDate),
    leaseStart: startDate,
    leaseEnd: row?.endDate || '',
    status: row?.status || 'active',
  };
}

/**
 * Every tenancy a caller has just fetched, named after the flat it is for.
 *
 * `toRentalCard` takes the listing as an optional second argument and falls back to a generic
 * "Rented home" without one — and no caller was passing it, so a tenant's rental hub, wallet and
 * document vault all described their home as "Rented home". `TenancyDto` is right not to carry the
 * title (copying the listing's own words onto the lease lets a renamed property disagree with
 * itself), which means the properties have to be fetched, and a tenant does not own the flat so it
 * is never in their `listings`.
 *
 * One batched call for the whole set rather than one per row, and a failure is swallowed: the
 * fallback label is worse than the title, but far better than a hub that renders nothing because
 * the property lookup was unavailable.
 *
 * The rows come back keyed under **both** identifiers a property answers to, because against the
 * real API the one asked for is not the one returned. `TenancyDto.propertyId` is the UUID — a lease
 * points at the row, not at a URL — while the property mapper sets `id: slug || uuid` so the UI can
 * route to `/property/:id`, parking the UUID on `uuid`. Every curated listing has a slug, so a map
 * keyed on `id` alone misses on every single tenancy, and the whole product falls back to "Rented
 * home": the rental hub, the wallet, the document vault, the rent page and the flatmate prefill.
 * Both keys rather than translating one into the other, because callers legitimately hold either —
 * Saved and Compare store whatever `id` the card carried, which is the slug.
 *
 * @param {object[]} rows `rentService.myTenancies()` rows
 * @returns {Promise<object[]>} the same rows as rental cards
 */
export async function toRentalCards(rows) {
  const list = rows || [];
  const ids = [...new Set(list.map((r) => r?.propId || r?.propertyId).filter(Boolean))];
  const props = ids.length ? await getPropertiesByIds(ids).catch(() => []) : [];
  const byId = new Map();
  (props || []).forEach((p) => {
    if (p?.id) byId.set(p.id, p);
    if (p?.uuid) byId.set(p.uuid, p);
  });
  return list.map((row) => toRentalCard(row, byId.get(row?.propId || row?.propertyId)));
}

/**
 * Rent status for a tenancy: whether this month is already paid, and when the next payment falls.
 *
 * `payments` is passed in rather than read here because the hub has already fetched the tenant's
 * history from the server; reading a second, local copy is how the card and the history table below
 * it used to disagree.
 *
 * A payment is matched by `tenancyId`, which is what the record actually carries — the old match on
 * `propId` compared a field the payment does not have, so it fell through to "any payment counts".
 * A payment with no tenancy still counts, because a tenant with one rental who paid through a flow
 * that did not stamp it plainly paid *this* rent, and refusing to match would show an unpaid month
 * to someone holding the receipt.
 */
export function tenancyStatus(t, payments = []) {
  const month = thisMonth();
  const paidThisMonth = (payments || []).some(
    (p) => p.month === month
      && p.settled !== false
      && (!t?.id || !p.tenancyId || p.tenancyId === t.id),
  );
  const now = new Date();
  const dueDay = Number(t?.dueDay) || 1;
  const due = new Date(now.getFullYear(), now.getMonth() + (paidThisMonth ? 1 : 0), dueDay);
  return {
    month,
    paidThisMonth,
    nextDue: due,
    nextDueLabel: due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
  };
}
