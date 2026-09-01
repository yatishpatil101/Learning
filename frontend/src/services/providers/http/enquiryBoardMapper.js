/**
 * Enquiry-board mapper — server rows into the shape the demand console renders (D25).
 *
 * ## The masked field is a value, not a flag
 *
 * The list returns `98XXXXX210` in the mobile field. Nothing here rewrites that into `null` plus a
 * `masked: true` boolean, because the console's job is to show an operator what the platform holds
 * and a row that says "hidden" tells them less than a row that says "a number ending 210 that you
 * may open if you have reason to". `isMasked` is derived from the value for the button's disabled
 * state; it is not a second source of truth, and if the server ever stops masking, the derivation
 * stops firing on its own.
 *
 * ## Dates
 *
 * Every timestamp arrives as an ISO instant. The console filters on `at` by comparing
 * `new Date(r.at)` against a cutoff, so `at` stays ISO rather than being pre-formatted — a
 * "12 Mar 2026" string parses to a date in whichever way the browser guesses, and the date filter was
 * the thing that broke when it guessed wrong.
 *
 * The one exception is a visit's `when`, which is written in the app's own visit vocabulary
 * (`19 Jul 2026, 10:30 AM (in-person)`) because `parseWhen` in `lib/visitWhen.js` reads it back and
 * the reschedule dialog round-trips through it. The raw instant is kept alongside as `slot`.
 */
import { formatWhen } from '../../../lib/visitWhen.js';

/** `98XXXXX210` — the shape `MobileMask` emits. Anything else is either real or absent. */
const MASK = /^\d{2}X{5}\d{3}$/;

export const isMasked = (mobile) => MASK.test(String(mobile ?? ''));

const pad = (n) => String(n).padStart(2, '0');

/**
 * An ISO instant into the visit vocabulary. Local time on purpose: a slot is an appointment somebody
 * keeps in Pune, and rendering it in UTC would move a 9am viewing to the small hours.
 */
function whenLabel(iso, mode) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dateIso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const h = d.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
  return formatWhen(dateIso, time, mode || '');
}

export function toEnquiry(dto) {
  if (!dto) return null;
  return {
    id: dto.id,
    propertyId: dto.propertyId ?? '',
    listing: dto.propertyTitle ?? '—',
    locality: dto.locality ?? '',
    customer: dto.requesterName ?? '—',
    mobile: dto.requesterMobile ?? '',
    status: dto.status ?? '',
    at: dto.createdAt ?? null,
  };
}

export function toVisit(dto) {
  if (!dto) return null;
  return {
    id: dto.id,
    propertyId: dto.propertyId ?? '',
    listing: dto.propertyTitle ?? '—',
    locality: dto.locality ?? '',
    customer: dto.visitorName ?? '—',
    mobile: dto.visitorMobile ?? '',
    slot: dto.slot ?? null,
    mode: dto.mode ?? '',
    when: whenLabel(dto.slot, dto.mode),
    status: dto.status ?? '',
    at: dto.createdAt ?? null,
  };
}

export function toDeal(dto) {
  if (!dto) return null;
  return {
    id: dto.id,
    propertyId: dto.propertyId ?? '',
    listing: dto.propertyTitle ?? '—',
    locality: dto.locality ?? '',
    deal: dto.deal ?? '',
    customer: dto.counterpartyName ?? '—',
    mobile: dto.counterpartyMobile ?? '',
    value: dto.agreedPrice ?? 0,
    status: dto.status ?? '',
    // The board's "Closed" column. An open deal has no closing date and falls back to when it was
    // opened, so the date filter has something to bite on for every row rather than silently
    // dropping the live ones.
    at: dto.closedAt ?? dto.createdAt ?? null,
    closedAt: dto.closedAt ?? null,
  };
}
