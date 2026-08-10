/* Shared visit date/time vocabulary — one source of truth for booking a visit,
   rescheduling it (dashboard + admin) and reading it back. Keeping the slot list
   and the `when` string format in one place means a booked slot and a rescheduled
   slot always read from the same words and stay mutually parseable. */

// Curated visit windows (owner-friendly hours). The app's default "time picker".
export const VISIT_SLOTS = ['9:00 AM', '10:30 AM', '12:00 PM', '1:30 PM', '3:00 PM', '4:30 PM', '6:00 PM', '7:00 PM'];

const MON_ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const pad = (n) => String(n).padStart(2, '0');

// Local "today" as yyyy-mm-dd — the min bound for forward-only visit dates.
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// A visit's `when` comes in two shapes: seed data uses an ISO date ("2026-07-07"),
// while a booked/rescheduled visit stores a human string ("19 Jul 2026, 10:30 AM
// (in-person)"). Parse both into a real Date plus the slot time + mode when known.
export function parseWhen(when) {
  if (!when) return { date: null, timeLabel: '', mode: '' };
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(when);
  if (iso) return { date: new Date(+iso[1], +iso[2] - 1, +iso[3]), timeLabel: '', mode: '' };
  const timeM = /(\d{1,2}:\d{2})\s*([AP]M)/i.exec(when);
  const modeM = /\(([^)]+)\)/.exec(when);
  // The canonical string carries the year ("19 Jul 2026"); capture it when present. The `\d{4}` after
  // the month cannot collide with the time — `10:30` has a colon — so this stays a superset of the
  // old day+month match.
  const dm = /(\d{1,2})\s+([A-Za-z]{3,})(?:\s+(\d{4}))?/.exec(when);
  let date = null;
  if (dm) {
    const mon = MON_ABBR[dm[2].slice(0, 3).toLowerCase()];
    if (mon != null) {
      if (dm[3]) {
        // Honour the year the string states (D88). Reconstructing it from "now" — the fallback below
        // — is wrong for any visit whose year is not the current one: a completed visit in a past
        // year rendered a year in the future, and a booking that crosses a December would roll to the
        // wrong side. Only strings that omit the year (legacy seed data) fall through to the guess.
        date = new Date(+dm[3], mon, +dm[1]);
      } else {
        const now = new Date();
        let d = new Date(now.getFullYear(), mon, +dm[1]);
        const floor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        if (d < floor) d = new Date(now.getFullYear() + 1, mon, +dm[1]);
        date = d;
      }
    }
  }
  return { date, timeLabel: timeM ? `${timeM[1]} ${timeM[2].toUpperCase()}` : '', mode: modeM ? modeM[1] : '' };
}

// Human, locale-stable date part ("19 Jul 2026") for an ISO date, or '' if blank.
export function displayDate(dateIso) {
  return dateIso ? new Date(`${dateIso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

// Build the canonical `when` string that parseWhen can read back:
// "19 Jul 2026, 10:30 AM (in-person)". Mode is optional.
export function formatWhen(dateIso, time, mode) {
  return `${displayDate(dateIso)}, ${time}${mode ? ` (${mode})` : ''}`;
}

// yyyy-mm-dd for a `when` string, for seeding the calendar when rescheduling.
export function isoFromWhen(when) {
  const { date } = parseWhen(when);
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : '';
}

/* ---------- the wire boundary ----------
   The server models a visit slot as a single ISO instant plus a separate `mode`; this app has
   always modelled it as one human `when` string ("19 Jul 2026, 10:30 AM (in-person)") that the
   whole dashboard — calendar grid, reschedule dialog, day grouping — reads through parseWhen.

   Converting at the seam rather than rewriting those consumers keeps one vocabulary in the UI, and
   keeps that vocabulary here, beside the parser it has to stay mutually readable with. A conversion
   that drifts from parseWhen produces a visit that displays but cannot be rescheduled. */

// "10:30 AM" → { h, m } in 24-hour terms. Returns null for anything unparseable.
function parseSlotTime(timeLabel) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(String(timeLabel || '').trim());
  if (!m) return null;
  let h = +m[1] % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return { h, m: +m[2] };
}

/**
 * A `when` string (and optional explicit date/time) → an ISO instant for the wire.
 *
 * Built from local date parts rather than by parsing a string, because `new Date("19 Jul 2026,
 * 10:30 AM")` is implementation-defined and silently yields UTC in some engines — which shifts an
 * Indian morning slot onto the previous evening.
 *
 * Falls back to midday rather than midnight when the time is missing: a date-only visit rendered in
 * any timezone west of IST would otherwise land on the day before.
 */
export function slotFromWhen(when) {
  const { date, timeLabel } = parseWhen(when);
  if (!date) return null;
  const t = parseSlotTime(timeLabel) || { h: 12, m: 0 };
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), t.h, t.m, 0, 0).toISOString();
}

/**
 * Explicit date + slot → an ISO instant. The booking form's path.
 *
 * Mode is deliberately not a parameter: it travels as its own field on the wire, and accepting it
 * here would imply it affects the instant, which it does not.
 */
export function slotFromParts(dateIso, timeLabel) {
  if (!dateIso) return null;
  const [y, mo, d] = dateIso.split('-').map(Number);
  const t = parseSlotTime(timeLabel) || { h: 12, m: 0 };
  return new Date(y, (mo || 1) - 1, d || 1, t.h, t.m, 0, 0).toISOString();
}

/**
 * An ISO instant + mode → the `when` string the dashboard renders and re-parses.
 *
 * Rendered from local parts so the round trip is stable: a visit booked at 10:30 AM IST must read
 * back as 10:30 AM, not as the UTC hour it was stored under.
 */
export function whenFromSlot(slot, mode) {
  if (!slot) return '';
  const d = new Date(slot);
  if (Number.isNaN(d.getTime())) return '';
  const dateIso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const h24 = d.getHours();
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return formatWhen(dateIso, `${h12}:${pad(d.getMinutes())} ${suffix}`, mode);
}
