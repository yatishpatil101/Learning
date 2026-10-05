import { fmtAgo } from './helpers.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const AGE_WARNING_HOURS = 24;
const AGE_BREACH_HOURS = 72;
const DUE_SOON_MS = 2 * HOUR_MS;
const REGISTRATION_MONTHS = 4;
const REGISTRATION_WARNING_DAYS = 30;
const TONE_CLASS = { breach: 'text-rose-300', warning: 'text-amber-200' };
const CLOSED = new Set(['completed', 'cancelled']);

const addMonths = (ts, months) => {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
};

// Registration Act 1908 s.23 counts four months from execution. Nobody signs before the customer
// approves the draft, so counting from approval gives the earliest the window can close.
function registrationDeadline(request) {
  if (request?.type !== 'rental' || request.status !== 'approved') return null;
  const approvedAt = Math.max(0, ...(request.timeline || [])
    .filter((e) => e.stage === 'draft.approved')
    .map((e) => e.at || 0));
  return approvedAt ? addMonths(approvedAt, REGISTRATION_MONTHS) : null;
}

function span(ms) {
  const hours = Math.max(1, Math.round(Math.abs(ms) / HOUR_MS));
  return hours <= 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

// The server's clock (RentAgreementSla) runs from when the matter became the desk's move.
function slaTone(request, now) {
  const { sla } = request;
  if (sla.waitingOn === 'customer') return { label: "Customer's turn", tone: 'muted' };
  const deadline = registrationDeadline(request);
  const statutory = deadline
    ? ` · register by ${new Date(deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : '';
  const left = (sla.dueAt || now) - now;
  if (sla.overdue || left < 0) return { label: `Overdue by ${span(left)}${statutory}`, tone: 'breach' };
  return { label: `Due in ${span(left)}${statutory}`, tone: left <= DUE_SOON_MS ? 'warning' : 'fresh' };
}

function ageTone(request, now = Date.now()) {
  if (request?.sla && !CLOSED.has(request.status)) return slaTone(request, now);
  const deadline = registrationDeadline(request);
  if (deadline) {
    const by = new Date(deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const daysLeft = (deadline - now) / DAY_MS;
    if (daysLeft < 0) return { label: `Register by ${by} · overdue`, tone: 'breach' };
    return { label: `Register by ${by}`, tone: daysLeft <= REGISTRATION_WARNING_DAYS ? 'warning' : 'fresh' };
  }
  const openedAt = Number(request?.createdAt);
  if (!Number.isFinite(openedAt) || openedAt <= 0) return { label: '—', tone: 'muted' };
  if (CLOSED.has(request.status)) return { label: fmtAgo(openedAt), tone: 'muted' };
  const hours = (now - openedAt) / HOUR_MS;
  if (hours >= AGE_BREACH_HOURS) return { label: `${fmtAgo(openedAt)} · overdue`, tone: 'breach' };
  if (hours >= AGE_WARNING_HOURS) return { label: `${fmtAgo(openedAt)} · due soon`, tone: 'warning' };
  return { label: fmtAgo(openedAt), tone: 'fresh' };
}

export default function AgeTone({ request }) {
  const { label, tone } = ageTone(request);
  return (
    <span className={TONE_CLASS[tone] || 'text-gray-400'} data-testid={`service-request-age-${tone}`}>
      {label}
    </span>
  );
}
