import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import Icon from '../Icon.jsx';
import Modal from '../ui/Modal.jsx';
import DateField from '../ui/DateField.jsx';
import TimeField from '../ui/TimeField.jsx';
import { parseWhen, formatWhen } from '../../lib/visitWhen.js';

const CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CAL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dateKeyOf = (d) =>`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const Card = ({ children, className = '' }) => (
  <div className={'glass-card rounded-2xl ' + className}>{children}</div>
);

const SectionHead = ({ icon, iconCls = 'text-teal-400', title, sub, action }) => (
  <div className="flex items-start justify-between gap-3 mb-4">
    <div className="flex items-center gap-3">
      {icon && <div className={'w-9 h-9 rounded-xl flex items-center justify-center ' + (iconCls.includes('bg-') ? iconCls : `bg-${iconCls.replace('text-', '')}/15 ${iconCls}`)}><Icon name={icon} className="w-4.5 h-4.5" /></div>}
      <div><h3 className="text-white font-bold text-sm">{title}</h3>{sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}</div>
    </div>
    {action}
  </div>
);

const STATUS_CLS = {
  scheduled: 'bg-amber-500/15 text-amber-300',
  confirmed: 'bg-emerald-500/15 text-emerald-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-rose-500/15 text-rose-300',
  'no-show': 'bg-rose-500/15 text-rose-300',
};
const STATUS_LABEL = { scheduled: 'Awaiting confirmation', confirmed: 'Confirmed', completed: 'Visited', cancelled: 'Cancelled', 'no-show': 'No-show' };

const StatusBadge = ({ status }) => (
  <span className={'text-[11px] px-2 py-0.5 rounded-full font-semibold ' + (STATUS_CLS[status] || 'bg-white/10 text-gray-300')}>{STATUS_LABEL[status] || status}</span>
);

const btnConfirm = 'px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25 flex items-center gap-1';
const btnCancel = 'px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 text-xs font-semibold hover:bg-rose-500/25 flex items-center gap-1';
const btnGhost = 'px-2.5 py-1.5 rounded-lg bg-white/5 text-gray-300 text-xs font-semibold hover:bg-white/10 flex items-center gap-1';

// Status → calendar colours (chip background + legend/dot). Scheduled uses amber
// (matching the "Awaiting confirmation" badge) so it reads clearly apart from the
// emerald "Confirmed / visited" family; cancelled/no-show are rose.
const visitChip = (status) =>
  status === 'completed' ? { chip: 'bg-emerald-500/15 text-emerald-200', dot: 'bg-emerald-400' }
    : (status === 'cancelled' || status === 'no-show') ? { chip: 'bg-rose-500/15 text-rose-300', dot: 'bg-rose-400' }
      : status === 'confirmed' ? { chip: 'bg-emerald-500/12 text-emerald-200', dot: 'bg-emerald-400' }
        : { chip: 'bg-amber-500/15 text-amber-200', dot: 'bg-amber-400' };

const LegendDot = ({ cls, label }) => (
  <span className="inline-flex items-center gap-1.5 text-gray-400"><span className={'w-2 h-2 rounded-full ' + cls} />{label}</span>
);

// ─── WhatsApp handoff (prototype: opens wa.me with a status-aware, pre-filled
// message). The owner messages the visitor (v.mobile); the seeker messages the
// owner (v.ownerMobile, enriched at load). Matches the app-wide wa.me/91… pattern.
const waDigits = (m) => (m || '').replace(/\D/g, '').replace(/^91/, '');
const btnWhatsapp = 'px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25 flex items-center gap-1';

function visitWaMessage(v, isOwner, dateStr, timeLabel) {
  const listing = (v.listing || 'the property').split(' in ')[0];
  const whenBit = [dateStr && `on ${dateStr}`, timeLabel && `at ${timeLabel}`].filter(Boolean).join(' ');
  if (isOwner) {
    const hi = `Hi ${v.customer || 'there'}, `;
    if (v.status === 'confirmed') return `${hi}your visit to ${listing} is confirmed ${whenBit}. See you then! — PuneNest`;
    if (v.status === 'cancelled' || v.status === 'no-show') return `${hi}unfortunately the visit to ${listing} ${whenBit} has been cancelled. Happy to help you reschedule. — PuneNest`;
    return `${hi}regarding your visit request for ${listing}${whenBit ? ` ${whenBit}` : ''}. Let me know if the slot works and I'll confirm it. — PuneNest`;
  }
  return `Hi, regarding my visit to ${listing}${whenBit ? ` ${whenBit}` : ''} (booked via PuneNest). Could you confirm the slot?`;
}

const waHref = (mobile, text) => `https://wa.me/91${waDigits(mobile)}?text=${encodeURIComponent(text)}`;

export default function VisitsTab({ visits, toast, isOwner = false, onUpdate }) {
  // Render straight from the `visits` prop (the single source in Dashboard) so
  // confirm/cancel/reschedule/visited persist and stay in sync with the leads
  // badge + Action Center. `onUpdate(id, patch)` lifts the change to the parent.
  const visitList = visits || [];

  const updateVisit = (id, status) => {
    onUpdate?.(id, { status });
    const msg = status === 'confirmed' ? 'Visit confirmed' : status === 'cancelled' ? 'Visit cancelled' : status === 'completed' ? 'Marked as visited' : 'Visit updated';
    toast(msg, 'success');
  };

  // Reschedule uses the shared Modal + a date field, then rewrites the visit's
  // date and returns it to "scheduled" so the other party re-confirms the slot.
  const [reschedule, setReschedule] = useState(null);
  const [reDate, setReDate] = useState('');
  const [reTime, setReTime] = useState('');
  const openReschedule = (v) => {
    const p = parseWhen(v.when);
    setReschedule(v);
    setReDate(p.date ? dateKeyOf(p.date) : '');
    setReTime(p.timeLabel || '10:30 AM');
  };
  const closeReschedule = () => { setReschedule(null); setReDate(''); setReTime(''); };
  const saveReschedule = () => {
    if (!reschedule || !reDate || !reTime) return;
    const id = reschedule.id;
    // Keep the visit's original mode (in-person / video) and fold date + time back
    // into one `when` string that parseWhen can read, so the chosen slot persists.
    const mode = parseWhen(reschedule.when).mode || 'in-person';
    onUpdate?.(id, { when: formatWhen(reDate, reTime, mode), status: 'scheduled' });
    closeReschedule();
    toast('Visit rescheduled', 'success');
  };

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const parsed = useMemo(() => {
    const m = new Map();
    visitList.forEach((v) => m.set(v.id, parseWhen(v.when)));
    return m;
  }, [visitList]);

  const upcoming = useMemo(() => (
    visitList
      .filter((v) => v.status === 'scheduled' || v.status === 'confirmed')
      .sort((a, b) => {
        const da = parsed.get(a.id)?.date;
        const dbt = parsed.get(b.id)?.date;
        return (da ? da.getTime() : Infinity) - (dbt ? dbt.getTime() : Infinity);
      })
  ), [visitList, parsed]);
  const completed = visitList.filter((v) => v.status === 'completed');
  const cancelled = visitList.filter((v) => v.status === 'cancelled' || v.status === 'no-show');

  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [weekView, setWeekView] = useState(null);

  const allVisitMap = useMemo(() => {
    const m = new Map();
    visitList.forEach((v) => { const d = parsed.get(v.id)?.date; if (!d) return; const key = dateKeyOf(d); m.set(key, [...(m.get(key) || []), v]); });
    return m;
  }, [visitList, parsed]);

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDay = new Date(calYear, calMonth, 1).getDay();

  const prevMonth = () => { if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(calMonth - 1); };
  const nextMonth = () => { if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(calMonth + 1); };
  const withTransition = (fn) => () => { if (document.startViewTransition) document.startViewTransition(fn); else fn(); };
  const openWeek = (day) => { const fn = () => { const clicked = new Date(calYear, calMonth, day); const ws = new Date(clicked); ws.setDate(clicked.getDate() - clicked.getDay()); setWeekView(ws); }; if (document.startViewTransition) document.startViewTransition(fn); else fn(); };
  const prevWeek = withTransition(() => { const d = new Date(weekView); d.setDate(d.getDate() - 7); setWeekView(d); });
  const nextWeek = withTransition(() => { const d = new Date(weekView); d.setDate(d.getDate() + 7); setWeekView(d); });
  const backToMonth = withTransition(() => setWeekView(null));

  const dayTag = (d) => {
    if (!d) return '';
    const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - startOfToday) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return '';
  };

  // ─── One actionable upcoming-visit row (confirm / reschedule / cancel / mark visited) ───
  const UpcomingRow = ({ v }) => {
    const p = parsed.get(v.id) || {};
    const d = p.date;
    const dateStr = d ? d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Date TBD';
    const tag = dayTag(d);
    const isPast = d && d < startOfToday;
    const who = isOwner ? v.customer : `Your ${p.mode || 'visit'}`;
    return (
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center flex-shrink-0"><Icon name="calendar-clock" className="w-5 h-5 text-teal-400" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-white text-sm font-medium truncate">{v.listing}</p>
            <StatusBadge status={v.status} />
          </div>
          <p className="text-gray-500 text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span className="text-gray-300">{who}</span>
            <span>·</span>
            <span className={tag ? 'text-teal-300 font-semibold' : ''}>{tag || dateStr}</span>
            {p.timeLabel && <><span>·</span><span>{p.timeLabel}</span></>}
            {p.mode && isOwner && <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 capitalize"><Icon name={p.mode === 'video' ? 'video' : 'map-pin'} className="w-3 h-3" /> {p.mode}</span>}
          </p>
        </div>
        {/* Action buttons meet the 44px tap-target minimum on phones (the same
            standard as CallBtn/WhatsAppBtn) then relax to their compact size from
            `sm` up, so the desktop row stays exactly as before. */}
        <div className="flex items-center gap-1.5 flex-wrap [&>*]:min-h-[44px] sm:[&>*]:min-h-0">
          {(() => {
            const target = isOwner ? v.mobile : v.ownerMobile;
            if (!waDigits(target)) return null;
            const text = visitWaMessage(v, isOwner, tag || dateStr, p.timeLabel);
            return (
              <a href={waHref(target, text)} target="_blank" rel="noopener noreferrer" className={btnWhatsapp} aria-label={isOwner ? `WhatsApp ${v.customer || 'visitor'}` : 'WhatsApp the owner'}>
                <Icon name="message-circle" className="w-3.5 h-3.5" /> WhatsApp
              </a>
            );
          })()}
          {v.status === 'scheduled' && isOwner && <button onClick={() => updateVisit(v.id, 'confirmed')} className={btnConfirm}><Icon name="check" className="w-3.5 h-3.5" /> Confirm</button>}
          {v.status === 'confirmed' && isPast && <button onClick={() => updateVisit(v.id, 'completed')} className={btnConfirm}><Icon name="check-circle" className="w-3.5 h-3.5" /> Mark visited</button>}
          <button onClick={() => openReschedule(v)} className={btnGhost}><Icon name="calendar" className="w-3.5 h-3.5" /> Reschedule</button>
          <button onClick={() => updateVisit(v.id, 'cancelled')} className={btnCancel}><Icon name="x" className="w-3.5 h-3.5" /> Cancel</button>
          <Link to={`/property/${v.listingId}`} className={btnGhost}><Icon name="arrow-right" className="w-3.5 h-3.5" /> Property</Link>
        </div>
      </div>
    );
  };

  const UpcomingCard = () => (
    <Card className="p-6">
      <SectionHead
        icon="calendar-clock"
        title={isOwner ? 'Upcoming visits' : 'Your upcoming visits'}
        sub={upcoming.length ? `${upcoming.length} visit${upcoming.length > 1 ? 's' : ''} — ${isOwner ? 'confirm, reschedule or cancel' : 'reschedule or cancel anytime'}` : 'Nothing scheduled right now'}
        action={<Link to="/schedule-visit" className="text-teal-400 text-sm font-medium hover:text-teal-300 whitespace-nowrap">Schedule new →</Link>}
      />
      {upcoming.length === 0 ? (
        <div className="text-center py-8">
          <div className="w-12 h-12 rounded-2xl bg-teal-400/15 flex items-center justify-center mx-auto mb-3"><Icon name="calendar-check" className="w-6 h-6 text-teal-400" /></div>
          <p className="text-white font-semibold text-sm">No visits scheduled</p>
          <p className="text-gray-400 text-xs mt-1 max-w-xs mx-auto">{isOwner ? 'When buyers or tenants book a site visit on your listings, it shows up here to confirm.' : 'Book a site visit from any property and track it here.'}</p>
          <Link to="/listings" className="btn-outline inline-flex items-center justify-center gap-2 mt-4 py-2.5 px-4 rounded-xl text-sm"><Icon name="search" className="w-4 h-4" /> Browse listings</Link>
        </div>
      ) : (
        <div className="space-y-2.5">{upcoming.map((v) => <UpcomingRow key={v.id} v={v} />)}</div>
      )}
    </Card>
  );

  const VisitGroup = ({ list, icon, iconCls, title }) => (
    list.length > 0 ? (
      <Card className="p-6">
        <SectionHead icon={icon} iconCls={iconCls} title={title} sub={`${list.length} visit${list.length > 1 ? 's' : ''}`} />
        <div className="space-y-2.5">
          {list.map((v) => {
            const p = parsed.get(v.id) || {};
            const dateStr = p.date ? p.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date TBD';
            return (
              <div key={v.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className={`w-10 h-10 rounded-xl ${iconCls.includes('emerald') ? 'bg-emerald-500/15' : 'bg-rose-500/15'} flex items-center justify-center flex-shrink-0`}><Icon name={icon} className={`w-5 h-5 ${iconCls}`} /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{v.listing}</p>
                  <p className="text-gray-500 text-xs">{isOwner ? v.customer : 'Your visit'} · {dateStr}</p>
                </div>
                <Link to={`/property/${v.listingId}`} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 text-gray-300 font-semibold hover:bg-white/10">View property</Link>
              </div>
            );
          })}
        </div>
      </Card>
    ) : null
  );

  const RescheduleModal = () => (
    <Modal
      open={!!reschedule}
      onClose={closeReschedule}
      title={reschedule ? `Reschedule · ${reschedule.listing}` : 'Reschedule visit'}
      size="sm"
      footer={(
        <>
          <button onClick={closeReschedule} className={btnGhost}>Cancel</button>
          <button onClick={saveReschedule} disabled={!reDate || !reTime} className={btnConfirm + ' disabled:opacity-40 disabled:cursor-not-allowed'}><Icon name="calendar-check" className="w-3.5 h-3.5" /> Save new slot</button>
        </>
      )}
    >
      {reschedule ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">{isOwner ? reschedule.customer : 'Your visit'}</p>
          <label className="block text-xs font-semibold text-gray-300">New visit date</label>
          <DateField
            value={reDate}
            onChange={(iso) => setReDate(iso)}
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
            ariaLabel="New visit date"
          />
          <label className="block text-xs font-semibold text-gray-300 pt-1">Time of day</label>
          <TimeField
            value={reTime}
            onChange={setReTime}
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
            ariaLabel="New visit time"
          />
          <p className="text-xs text-gray-500">The visit returns to “Awaiting confirmation” so the {isOwner ? 'visitor' : 'owner'} can re-confirm the new time.</p>
          {(() => {
            const target = isOwner ? reschedule.mobile : reschedule.ownerMobile;
            if (!waDigits(target) || !reDate || !reTime) return null;
            const label = new Date(reDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
            const listing = (reschedule.listing || 'the property').split(' in ')[0];
            const text = isOwner
              ? `Hi ${reschedule.customer || 'there'}, can we move your visit to ${listing} to ${label} at ${reTime}? Please confirm and I'll lock it in. — PuneNest`
              : `Hi, could we reschedule my visit to ${listing} to ${label} at ${reTime}? (via PuneNest)`;
            return (
              <a href={waHref(target, text)} target="_blank" rel="noopener noreferrer" className={btnWhatsapp + ' w-full justify-center'}>
                <Icon name="message-circle" className="w-3.5 h-3.5" /> Notify new time on WhatsApp
              </a>
            );
          })()}
        </div>
      ) : null}
    </Modal>
  );

  // Empty state — a user with zero visits of any kind.
  if (visitList.length === 0) {
    return (
      <div className="space-y-6">
        <Card className="p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-teal-400/15 flex items-center justify-center mx-auto mb-4"><Icon name="calendar-check" className="w-7 h-7 text-teal-400" /></div>
          <h3 className="text-white font-bold">No visits yet</h3>
          <p className="text-gray-400 text-sm mt-1.5 max-w-sm mx-auto">{isOwner ? 'Site-visit requests on your listings will appear here so you can confirm, reschedule or cancel them.' : 'Book a site visit from any property to line up a viewing — you can track and manage it here.'}</p>
          <div className="flex items-center justify-center gap-2.5 mt-5">
            <Link to="/listings" className="btn-outline inline-flex items-center gap-2 py-2.5 px-4 rounded-xl text-sm"><Icon name="search" className="w-4 h-4" /> Browse listings</Link>
            <Link to="/schedule-visit" className="btn-teal inline-flex items-center gap-2 py-2.5 px-4 rounded-xl text-sm text-white"><Icon name="calendar-check" className="w-4 h-4" /> Schedule a visit</Link>
          </div>
        </Card>
      </div>
    );
  }

  // ─── WEEK VIEW (per-day agenda — real slot time when known, else "Time TBD") ───
  if (weekView) {
    const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekView); d.setDate(weekView.getDate() + i); return d; });
    const weekLabel = `${weekDays[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${weekDays[6].toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;

    return (
      <div className="space-y-6">
        <Card className="p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <button onClick={backToMonth} className="flex items-center gap-1.5 text-sm text-teal-400 hover:text-teal-300 font-medium"><Icon name="arrow-left" className="w-4 h-4" /> Month view</button>
            <div className="flex items-center gap-3">
              <button onClick={prevWeek} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 text-gray-400"><Icon name="chevron-left" className="w-4 h-4" /></button>
              <h3 className="text-white font-semibold text-sm">{weekLabel}</h3>
              <button onClick={nextWeek} className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 text-gray-400"><Icon name="chevron-right" className="w-4 h-4" /></button>
            </div>
            <Link to="/schedule-visit" className="text-teal-400 text-xs font-medium hover:text-teal-300">+ New visit</Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {weekDays.map((d) => {
              const isToday = d.toDateString() === today.toDateString();
              const dayVisits = allVisitMap.get(dateKeyOf(d)) || [];
              return (
                <div key={d.toISOString()} className={'rounded-xl border p-3 min-h-[110px] ' + (isToday ? 'border-teal-400/40 bg-teal-500/[0.06]' : 'border-white/[0.06] bg-white/[0.02]')}>
                  <div className="flex items-center justify-between mb-2">
                    <p className={'text-xs font-semibold ' + (isToday ? 'text-teal-300' : 'text-gray-300')}>{CAL_DAYS[d.getDay()]} {d.getDate()}</p>
                    {dayVisits.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-400 font-semibold">{dayVisits.length}</span>}
                  </div>
                  {dayVisits.length === 0 ? (
                    <p className="text-[11px] text-gray-600">No visits</p>
                  ) : (
                    <div className="space-y-1.5">
                      {dayVisits.map((v) => {
                        const p = parsed.get(v.id) || {};
                        const colors = v.status === 'completed' ? 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30' : (v.status === 'cancelled' || v.status === 'no-show') ? 'bg-rose-500/12 text-rose-300 border-rose-400/25' : v.status === 'confirmed' ? 'bg-emerald-500/12 text-emerald-200 border-emerald-400/25' : 'bg-amber-500/12 text-amber-200 border-amber-400/25';
                        return (
                          <Link key={v.id} to={`/property/${v.listingId}`} className={'block rounded-lg border px-2 py-1.5 ' + colors}>
                            <p className="text-[11px] font-bold truncate leading-tight">{v.listing.split(' in ')[0]}</p>
                            <p className="text-[10px] opacity-80 truncate">{p.timeLabel || 'Time TBD'} · {isOwner ? v.customer : 'You'}</p>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
        <RescheduleModal />
      </div>
    );
  }

  // ─── MONTH VIEW ───
  return (
    <div className="space-y-6">
      <UpcomingCard />

      <Card className="p-4 sm:p-6">
        <SectionHead icon="calendar-check" iconCls="text-teal-400" title="Visit calendar" sub="Every scheduled, confirmed and past visit at a glance" action={<Link to="/schedule-visit" className="text-teal-400 text-sm font-medium hover:text-teal-300 whitespace-nowrap">Schedule new →</Link>} />
        <div className="flex items-center justify-between mt-4 mb-4">
          <button onClick={prevMonth} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 active:bg-white/15 active:scale-95 text-gray-400 transition"><Icon name="chevron-left" className="w-4 h-4" /></button>
          <div className="text-center">
            <h3 className="text-white font-semibold text-sm">{CAL_MONTHS[calMonth]} {calYear}</h3>
            <p className="text-gray-500 text-[10px] mt-0.5">Click a day to see the weekly schedule</p>
          </div>
          <button onClick={nextMonth} className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 active:bg-white/15 active:scale-95 text-gray-400 transition"><Icon name="chevron-right" className="w-4 h-4" /></button>
        </div>

        <div role="note" aria-label="Calendar legend" className="flex items-center flex-wrap gap-x-4 gap-y-1.5 mb-3 text-[11px] font-medium">
          <LegendDot cls="bg-amber-400" label="Scheduled" />
          <LegendDot cls="bg-emerald-400" label="Confirmed / visited" />
          <LegendDot cls="bg-rose-400" label="Cancelled" />
        </div>

        <div className="rounded-xl overflow-hidden ring-1 ring-white/[0.06] bg-black/20">
          {/* Weekday header — teal-tinted band, no hard white grid lines */}
          <div className="grid grid-cols-7 bg-gradient-to-b from-teal-500/[0.16] to-teal-500/[0.05] border-b border-teal-400/10">
            {CAL_DAYS.map((d, idx) => {
              const weekend = idx === 0 || idx === 6;
              return (
                <div key={d} className="text-center py-2.5">
                  <p className={'text-[11px] font-bold uppercase tracking-wider ' + (weekend ? 'text-teal-100/35' : 'text-teal-50/80')}>{d}</p>
                </div>
              );
            })}
          </div>

          {/* Day grid — one uniform whisper-soft hairline (white/[0.04]) replaces the old stacked borders */}
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDay }).map((_, i) => <div key={'e' + i} className="min-h-[76px] border-b border-r border-white/[0.04] bg-white/[0.008]" />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateKey = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isToday = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
              const dayVisits = allVisitMap.get(dateKey) || [];
              const hasVisit = dayVisits.length > 0;
              return (
                <div key={day} onClick={() => openWeek(day)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openWeek(day)} className={'relative p-1.5 min-h-[76px] cursor-pointer transition border-b border-r border-white/[0.04] focus-visible:ring-2 focus-visible:ring-teal-400/50 focus-visible:z-10 outline-none ' + (isToday ? 'bg-teal-500/[0.12]' : hasVisit ? 'bg-white/[0.02] hover:bg-white/[0.05]' : 'hover:bg-white/[0.03]')}>
                  <span className={'inline-flex items-center justify-center mb-1 text-xs font-bold ' + (isToday ? 'w-6 h-6 rounded-full bg-teal-500 text-white shadow-[0_2px_8px_rgba(20,184,166,0.5)]' : 'text-gray-300')}>{day}</span>
                  <div className="hidden sm:block space-y-0.5">
                    {dayVisits.slice(0, 2).map((v) => {
                      const { chip, dot } = visitChip(v.status);
                      return (
                        <div key={v.id} className={'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight ' + chip}>
                          <span className={'w-1.5 h-1.5 rounded-full flex-shrink-0 ' + dot} />
                          <span className="truncate">{v.listing.split(' in ')[0]}</span>
                        </div>
                      );
                    })}
                    {dayVisits.length > 2 && <div className="text-[9px] text-gray-500 font-medium pl-0.5">+{dayVisits.length - 2} more</div>}
                  </div>
                  {hasVisit && (
                    <div className="flex sm:hidden flex-wrap gap-1 mt-0.5">
                      {dayVisits.slice(0, 4).map((v) => <span key={v.id} className={'w-1.5 h-1.5 rounded-full ' + visitChip(v.status).dot} />)}
                    </div>
                  )}
                </div>
              );
            })}
            {(() => {
              const trail = (7 - ((firstDay + daysInMonth) % 7)) % 7;
              return Array.from({ length: trail }).map((_, i) => <div key={'t' + i} className="min-h-[76px] border-b border-r border-white/[0.04] bg-white/[0.008]" />);
            })()}
          </div>
        </div>
      </Card>

      <VisitGroup list={completed} icon="check-circle" iconCls="text-emerald-400" title="Completed visits" />
      <VisitGroup list={cancelled} icon="x-circle" iconCls="text-rose-400" title="Cancelled visits" />
      <RescheduleModal />
    </div>
  );
}
