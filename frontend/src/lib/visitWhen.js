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
  const dm = /(\d{1,2})\s+([A-Za-z]{3,})/.exec(when);
  let date = null;
  if (dm) {
    const mon = MON_ABBR[dm[2].slice(0, 3).toLowerCase()];
    if (mon != null) {
      const now = new Date();
      let d = new Date(now.getFullYear(), mon, +dm[1]);
      const floor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      if (d < floor) d = new Date(now.getFullYear() + 1, mon, +dm[1]);
      date = d;
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
