import Icon from '../../../components/Icon.jsx';
import HScroll from '../../../components/ui/HScroll.jsx';
import { Link } from 'react-router';

export const Card = ({ children, className = '', ...rest }) => (
  <div className={'glass-card rounded-2xl ' + className} {...rest}>{children}</div>
);

export function Stat({ icon, bg, fg, value, label, trend, onClick, ariaLabel }) {
  const tIcon = trend ? (trend.dir === 'up' ? 'trending-up' : trend.dir === 'down' ? 'trending-down' : 'minus') : null;
  // Status → a small, legible chip instead of faint gray text, so the sub-status
  // reads at a glance: green = positive/handled, red = needs attention, neutral = info.
  const tChip = trend
    ? (trend.dir === 'up'
        ? 'bg-emerald-500/15 text-emerald-300'
        : trend.dir === 'down'
          ? 'bg-rose-500/15 text-rose-300'
          : 'bg-white/[0.06] text-gray-400')
    : '';
  // Compact layout: icon + number share one row (was stacked), so each tile is
  // markedly shorter — four fit with far less scroll on a phone.
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span className={'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ' + bg}>
          <Icon name={icon} className={'h-4 w-4 ' + fg} />
        </span>
        <span className="text-2xl font-bold leading-none text-white">{value}</span>
      </div>
      <p className="mt-2 truncate text-xs font-medium text-gray-300">{label}</p>
      {trend ? (
        <span className={'mt-2 inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ' + tChip}>
          {tIcon ? <Icon name={tIcon} className="h-2.5 w-2.5 flex-shrink-0" /> : null}
          <span className="truncate">{trend.text}</span>
        </span>
      ) : null}
    </>
  );
  // When a target is provided, the whole tile becomes a keyboard-focusable button that
  // jumps to the tab behind the number — turning a passive stat into navigation.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel || label}
        className="glass-card group rounded-2xl p-3.5 sm:p-4 text-left w-full transition-all hover:border-teal-400/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
      >
        {body}
      </button>
    );
  }
  return <Card className="p-3.5 sm:p-4">{body}</Card>;
}

/* Horizontal sub-navigation used inside consolidated tabs (Activity, My Properties)
   to switch between grouped sub-sections without adding more top-level tabs. */
export function SubNav({ items, active, onChange, variant = 'pill' }) {
  if (!items || items.length < 2) return null;

  // Underline variant reuses the app-wide `.pn-detail-tab` style (same as the shared
  // <Tabs variant="underline"> used in Finances, property detail, etc.) so every tab
  // strip reads as one standard. Count badges are kept — they carry live lead volume.
  if (variant === 'underline') {
    return (
      <HScroll role="tablist" fadeColor="var(--brand-bg, #0e0c1a)" wrapClassName="mb-5" className="flex gap-1 sm:gap-2 border-b border-white/10">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active === it.key}
            onClick={() => onChange(it.key)}
            className={'pn-detail-tab' + (active === it.key ? ' is-active' : '')}
          >
            {it.icon ? <Icon name={it.icon} className="w-4 h-4" /> : null}
            <span>{it.label}</span>
            {it.count > 0 ? (
              <span className={'inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold ' + (active === it.key ? 'bg-brand-teal/20 text-brand-teal' : 'bg-white/10 text-gray-300')}>{it.count}</span>
            ) : null}
          </button>
        ))}
      </HScroll>
    );
  }

  return (
    <HScroll wrapClassName="-mx-1 mb-5" className="flex gap-1.5 px-1">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          aria-current={active === it.key ? 'page' : undefined}
          className={'inline-flex min-h-[44px] sm:min-h-[40px] items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-sm font-medium transition ' + (active === it.key ? 'border-brand-teal/30 bg-brand-teal/15 text-brand-teal' : 'border-transparent bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white')}
        >
          {it.icon ? <Icon name={it.icon} className="w-4 h-4" /> : null} {it.label}
          {it.count > 0 ? (
            <span className={'ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold ' + (active === it.key ? 'bg-brand-teal/25 text-brand-teal' : 'bg-white/10 text-gray-300')}>{it.count}</span>
          ) : null}
        </button>
      ))}
    </HScroll>
  );
}

export const SectionHead = ({ icon, iconCls = 'text-teal-400', title, sub, action }) => (
  <div className="flex flex-col gap-3 mb-5 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <h2 className="text-lg font-bold text-white flex items-center gap-2">
        {icon ? <Icon name={icon} className={'w-5 h-5 flex-shrink-0 ' + iconCls} /> : null} <span className="min-w-0 sm:truncate">{title}</span>
      </h2>
      {sub ? <p className="text-gray-500 text-xs mt-0.5">{sub}</p> : null}
    </div>
    {action ? <div className="w-full sm:w-auto sm:flex-shrink-0">{action}</div> : null}
  </div>
);

/* Tints for the request-row leading chip. Kept to the brand-teal family plus a few
   restrained semantic accents so every Requests sub-tab reads as one system. */
const CHIP_TINTS = {
  teal: 'bg-brand-teal/15 text-brand-teal',
  amber: 'bg-amber-400/15 text-amber-300',
  sky: 'bg-sky-400/15 text-sky-300',
  violet: 'bg-violet-400/15 text-violet-300',
  emerald: 'bg-emerald-400/15 text-emerald-300',
};

/* Borderless "quiet list" wrapper for request/lead rows. Replaces the old boxed
   rows (each outlined with border-white/8) — the outer Card is the only frame;
   inside, rows are separated by a single hairline divider, not a full box. */
export const RequestList = ({ children }) => (
  <div className="-mx-3 divide-y divide-white/[0.05]">{children}</div>
);

/* Per-row urgency pill tints. `hot` = SLA breached (needs a reply now), `warm` =
   ageing, so the most-at-risk lead is instantly recognizable in a scan. */
const URGENCY_TINTS = {
  hot: 'bg-rose-500/15 text-rose-300',
  warm: 'bg-amber-400/15 text-amber-300',
};

/* One request/lead row — mobile-first. `avatar` (initials) marks a person; `icon`+`tint`
   marks a system request type. `attention` raises a left accent bar (rose when urgent)
   so items awaiting your action read at a glance. `time` renders a right-aligned age pill;
   `urgency` ({ label, level }) surfaces an SLA badge on the row.

   Layout: the identity block is `basis-full` on phones so the actions/badges passed via
   `children` wrap onto their own thumb-friendly row (indented under the content, never
   squeezing the name/meta); from `sm` up they sit inline on the right. */
export function RequestRow({ icon, tint = 'teal', avatar, title, badge, meta, time, urgency, attention = false, onOpen, children }) {
  const chip = CHIP_TINTS[tint] || CHIP_TINTS.teal;
  const urgent = urgency?.level === 'hot';
  const identity = (
    <>
      {avatar != null ? (
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal to-emerald-500 text-xs font-bold text-white ring-1 ring-white/10">{avatar}</span>
      ) : (
        <span className={'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ' + chip}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
      )}
      <span className="block min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{title}</span>
          {badge ? (
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
              <Icon name="shield-check" className="h-2.5 w-2.5" />{badge}
            </span>
          ) : null}
          {urgency ? (
            <span className={'inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ' + (URGENCY_TINTS[urgency.level] || URGENCY_TINTS.warm)}>
              <Icon name="timer" className="h-2.5 w-2.5" />{urgency.label}
            </span>
          ) : time ? (
            <span className="flex-shrink-0 text-[13px] sm:text-[11px] font-medium text-gray-500">{time}</span>
          ) : null}
        </span>
        {meta ? <span className="mt-0.5 block line-clamp-2 text-xs text-gray-500 sm:truncate">{meta}</span> : null}
      </span>
    </>
  );
  return (
    <div className="group relative rounded-xl py-3.5 pl-4 pr-3 transition-colors hover:bg-white/[0.03]">
      {attention ? (
        <span aria-hidden="true" className={'absolute left-0 top-4 h-8 w-[3px] rounded-full ' + (urgent ? 'bg-rose-400' : 'bg-brand-teal')} />
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={'Open ' + (typeof title === 'string' ? title : 'lead') + ' details'}
            className="flex min-w-0 flex-1 basis-full items-center gap-4 rounded-lg text-left transition sm:basis-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50"
          >
            {identity}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 basis-full items-center gap-4 sm:basis-auto">{identity}</div>
        )}
        {children ? <div className="flex w-full flex-shrink-0 flex-wrap items-center gap-2 pl-[3.75rem] sm:w-auto sm:justify-end sm:pl-0">{children}</div> : null}
      </div>
    </div>
  );
}

/* Shared quick-action chips for a lead's contact number. Icon-only (h-11 w-11)
   in dense list rows; pass `label` for the full-width buttons in the detail sheet.
   Both meet the 44px touch-target minimum. Numbers are reduced to digits so a
   malformed value can't break out of the tel:/wa.me URL. */
const dialDigits = (m) => String(m == null ? '' : m).replace(/\D/g, '');
export function CallBtn({ mobile, name, label }) {
  const digits = dialDigits(mobile);
  if (!digits) return null;
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/5 font-semibold text-brand-teal transition hover:bg-white/10';
  return (
    <a href={'tel:' + digits} aria-label={('Call ' + (name || '')).trim()} className={base + (label ? ' min-h-[44px] px-3 text-xs' : ' h-11 w-11')}>
      <Icon name="phone" className="h-4 w-4" />{label ? <span>{label}</span> : null}
    </a>
  );
}
export function WhatsAppBtn({ mobile, name, label }) {
  const digits = dialDigits(mobile);
  if (!digits) return null;
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 font-semibold text-emerald-400 transition hover:bg-emerald-500/20';
  return (
    <a href={'https://wa.me/91' + digits} target="_blank" rel="noopener noreferrer" aria-label={('WhatsApp ' + (name || '')).trim()} className={base + (label ? ' min-h-[44px] px-3 text-xs' : ' h-11 w-11')}>
      <Icon name="message-circle" className="h-4 w-4" />{label ? <span>{label}</span> : null}
    </a>
  );
}

/* Small amber chip flagging a lead the owner scheduled a follow-up for. */
export function FollowUpChip({ ts }) {
  if (!ts) return null;
  const label = new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-1 text-[11px] font-semibold text-amber-300">
      <Icon name="calendar-clock" className="h-3 w-3" /> {label}
    </span>
  );
}

/* Consistent empty state for a Requests sub-tab — an invitation, not a dead end.
   An optional `cta` ({ to, label }) turns the empty inbox into a next action. */
export const RequestEmpty = ({ icon = 'inbox', text, cta }) => (
  <div className="flex flex-col items-center gap-3 py-10 text-center">
    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04]">
      <Icon name={icon} className="h-5 w-5 text-gray-500" />
    </div>
    <p className="text-sm text-gray-500">{text}</p>
    {cta ? (
      <Link to={cta.to} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal/15 px-3.5 py-2 text-xs font-semibold text-brand-teal transition hover:bg-brand-teal/25">
        {cta.icon ? <Icon name={cta.icon} className="h-3.5 w-3.5" /> : null} {cta.label}
      </Link>
    ) : null}
  </div>
);

export const StatusBadge = ({ status }) => {
  const map = {
    approved: 'bg-emerald-500/15 text-emerald-300',
    pending: 'bg-amber-500/15 text-amber-300',
    'Under Review': 'bg-amber-500/15 text-amber-300',
    rejected: 'bg-rose-500/15 text-rose-300',
    scheduled: 'bg-indigo-500/15 text-indigo-300',
    closed: 'bg-emerald-500/15 text-emerald-300',
    responded: 'bg-indigo-500/15 text-indigo-300',
    confirmed: 'bg-emerald-500/15 text-emerald-300',
    cancelled: 'bg-rose-500/15 text-rose-300',
    // Photo requests (V118). Without these two the pair falls through to the same grey chip, so a
    // declined row and a satisfied one look identical on the one screen the owner uses to tell them
    // apart. Rose rather than green for `declined` because it is a "no", but a legitimate one.
    resolved: 'bg-emerald-500/15 text-emerald-300',
    declined: 'bg-rose-500/15 text-rose-300',
  };
  const displayLabel = {
    pending: 'Under Review',
    'Under Review': 'Under Review',
  };
  const label = displayLabel[status] || String(status || '').replace('_', ' ');
  return (
    <span className={'text-[11px] px-2 py-0.5 rounded-full font-semibold capitalize ' + (map[status] || 'bg-white/10 text-gray-300')}>
      {label}
    </span>
  );
};
