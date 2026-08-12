import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { useSavedSearches } from '../../../context/SavedSearchContext.jsx';
import { ALERT_FREQUENCIES, DEFAULT_ALERT_FREQUENCY } from '../../../services/savedSearchService.js';
import { criteriaChips } from '../listings/alertCriteria.js';
import { flatmateCriteriaChips, tabMeta } from '../flatmates/alertCriteria.js';
import { normalizeTab } from '../flatmates/model.js';
import { Card, SectionHead } from './components.jsx';

const CHANNEL_META = {
  whatsapp: { label: 'WhatsApp', icon: 'message-circle' },
  sms: { label: 'SMS', icon: 'smartphone' },
};

/* The cadence the server's enum already supported and the UI could not reach: the row carried a
   two-state Switch, so `instant` and `weekly` were unreachable and switching off and on again
   flattened whatever you held to `daily` (D84). A native <select> rather than a custom menu — it is
   keyboard- and screen-reader-correct for free, and on a phone it opens the platform picker. */
const FREQ_LABEL = { off: 'Off', instant: 'Instant', daily: 'Daily', weekly: 'Weekly' };

const fmtDate = (ts) => {
  if (!ts) return '';
  try { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
};

export default function AlertsPanel() {
  // Shared with the Overview stat card and the match-count effect, so deleting an alert here no
  // longer leaves the count above it claiming the old number until a reload.
  const { searches: alerts, setFrequency, remove } = useSavedSearches();
  const activeCount = alerts.filter((a) => a.alerts).length;

  const onFrequency = (id, frequency) => setFrequency(id, frequency);
  const onDelete = (id) => remove(id);

  return (
    <Card className="p-6">
      <SectionHead
        icon="bell-plus"
        iconCls="text-amber-400"
        title="Property &amp; Flatmate Alerts"
        sub={alerts.length ? `${activeCount} active · we notify you when new matches are listed` : undefined}
        action={<Link to="/listings" className="text-teal-400 text-sm font-medium hover:text-teal-300">Browse listings →</Link>}
      />

      {alerts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10">
            <Icon name="bell-plus" className="h-6 w-6 text-amber-400" />
          </div>
          <p className="text-sm font-semibold text-white">No alerts yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
            Search for a home or a flatmate, then tap <span className="text-teal-300">Save search</span> or create an alert when nothing matches.
            We’ll notify you the moment a new listing fits — great for tight markets.
          </p>
          <Link to="/listings" className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-teal-400/30 bg-teal-500/10 px-4 py-2 text-sm font-semibold text-teal-200 transition hover:bg-teal-500/20">
            <Icon name="search" className="h-4 w-4" /> Start a search
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => {
            const ch = CHANNEL_META[a.channel] || CHANNEL_META.whatsapp;
            const isShare = a.kind === 'flatmates';
            const chips = isShare ? flatmateCriteriaChips(a) : criteriaChips(a);
            const viewHref = isShare ? `/flatmates?view=${normalizeTab(a.tab)}` : '/listings';
            return (
              <div key={a.id} className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {isShare && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-teal-400/30 bg-teal-500/10 px-2 py-0.5 text-[10px] font-semibold text-teal-200">
                        <Icon name={tabMeta(a.tab).icon} className="h-3 w-3" /> {tabMeta(a.tab).word}
                      </span>
                    )}
                    <p className="truncate text-sm font-semibold text-white">{a.label || 'Saved search'}</p>
                    {a.newCount > 0 && (
                      <span className="shrink-0 rounded-full bg-teal-500/15 px-2 py-0.5 text-[10px] font-bold text-teal-300">{a.newCount} new</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {chips.map((c, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-gray-300">
                        <Icon name={c.icon} className="h-3 w-3 text-gray-400" /> {c.text}
                      </span>
                    ))}
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-gray-400">
                      <Icon name={ch.icon} className="h-3 w-3" /> {ch.label}
                    </span>
                    {a.at && <span className="text-[11px] text-gray-600">· Created {fmtDate(a.at)}</span>}
                    <Link to={viewHref} className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-400 hover:text-teal-300">
                      <Icon name="arrow-right" className="h-3 w-3" /> View matches
                    </Link>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <label className="flex items-center gap-2 text-xs text-gray-400">
                    <span className={a.alerts ? 'text-teal-300' : ''}>Alerts</span>
                    <select
                      value={a.alertFrequency || (a.alerts === false ? 'off' : DEFAULT_ALERT_FREQUENCY)}
                      onChange={(e) => onFrequency(a.id, e.target.value)}
                      data-testid="alert-frequency"
                      aria-label={`Alert frequency for ${a.label || 'saved search'}`}
                      className="min-h-[44px] rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-gray-200 focus:border-teal-400/50 focus:outline-none"
                    >
                      {ALERT_FREQUENCIES.map((f) => (
                        <option key={f} value={f} className="bg-[#0f0d1a]">{FREQ_LABEL[f]}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => onDelete(a.id)}
                    aria-label={`Delete alert ${a.label || 'saved search'}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-gray-500 transition hover:border-rose-400/40 hover:text-rose-300"
                  >
                    <Icon name="trash-2" className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
