
import { digits } from '../contact.js';
import { getPropertiesByIds } from '../../services/propertyService.js';

function thisMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

/** Days past the 28th are clamped so a lease starting on the 31st does not silently skip February. */
function dueDayFromLease(startDate) {
  if (!startDate) return 1;
  const day = Number(String(startDate).slice(8, 10));
  if (!Number.isFinite(day) || day < 1) return 1;
  return Math.min(day, 28);
}

/** Tenancy rows lack title/address, so callers with the listing pass it in. */
export function toRentalCard(row, listing) {
  const startDate = row?.startDate || '';
  return {
    id: row?.id || '',
    propId: row?.propId || row?.propertyId || '',
    title: listing?.title || 'Rented home',
    address: listing?.address || listing?.locality || 'Pune',
    locality: listing?.locality || '',
    localitySlug: listing?.localitySlug || '',
    bhk: listing?.bhk || '',
    image: listing?.image || listing?.img || null,
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

/** One batched call for the whole set rather than one per row, and a failure is swallowed. */
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

/* Payment status can be unknown; do not derive a false "rent is due" from missing data. */
export function tenancyStatus(t) {
  const month = thisMonth();
  const now = new Date();
  const dueDay = Number(t?.dueDay) || 1;
  const due = new Date(now.getFullYear(), now.getMonth(), dueDay);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (due < startOfToday) due.setMonth(due.getMonth() + 1);
  return {
    month,
    nextDue: due,
    nextDueLabel: due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
  };
}
