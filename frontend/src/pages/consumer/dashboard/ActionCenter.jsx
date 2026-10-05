import { useState } from 'react';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { timeAgo } from '../../../lib/format.js';
import { Card, SectionHead } from './components.jsx';
/* Action Center — the single "what's waiting on ME" triage surface, pinned at the top of the dashboard Overview. */

const STALE_MS = 2 * 24 * 60 * 60 * 1000;

const TONES = {
  rose: 'bg-rose-500/15 text-rose-300',
  amber: 'bg-amber-500/15 text-amber-300',
  teal: 'bg-teal-400/15 text-teal-300',
  indigo: 'bg-indigo-500/15 text-indigo-300',
};

function isStale(at) {
  return !!at && Date.now() - at > STALE_MS;
}

function AgePill({ at, atText }) {
  if (at) {
    if (isStale(at)) {
      const days = Math.max(1, Math.round((Date.now() - at) / 86400000));
      return (
        <span className="whitespace-nowrap rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-300">
          {days}d waiting
        </span>
      );
    }
    return <span className="whitespace-nowrap text-[11px] text-gray-500">{timeAgo(at)}</span>;
  }
  if (atText) return <span className="whitespace-nowrap text-[11px] text-gray-500">{atText}</span>;
  return null;
}

export default function ActionCenter({ items = [], limit, onSeeAll }) {
  const [expandedId, setExpandedId] = useState(null);
  if (!items.length) {
    return (
      <Card className="p-5" data-testid="action-center-clear">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/15">
            <Icon name="check-circle-2" className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">You&apos;re all caught up</p>
            <p className="text-xs text-gray-500">No requests are waiting on you right now.</p>
          </div>
        </div>
      </Card>
    );
  }
  const visibleItems = limit ? items.slice(0, limit) : items;
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <Card className="p-5 sm:p-6" data-testid="action-center">
      <SectionHead
        icon="bell"
        iconCls="text-amber-400"
        title="Needs your attention"
        sub="Respond to these so no request goes stale waiting on you."
        action={
          <span className="whitespace-nowrap rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
            {items.length} pending
          </span>
        }
      />
      <div className="-mx-3 divide-y divide-white/[0.05]">
        {visibleItems.map((it) => {
          const stale = isStale(it.at);
          const expanded = expandedId === it.id;
          return (
            <div
              key={it.id}
              data-testid="action-item"
              role="button"
              tabIndex={0}
              onClick={() => setExpandedId(expanded ? null : it.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpandedId(expanded ? null : it.id);
                }
              }}
              className={
                'group relative flex cursor-pointer flex-col gap-3 rounded-xl py-3.5 pl-4 pr-3 transition-colors sm:flex-row sm:items-center sm:gap-3.5 ' +
                (stale ? 'bg-rose-500/[0.05] hover:bg-rose-500/[0.08]' : 'hover:bg-white/[0.03]')
              }
            >
              {stale ? (
                <span aria-hidden="true" className="absolute left-0 top-1/2 h-9 w-[3px] -translate-y-1/2 rounded-full bg-rose-400" />
              ) : null}
              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                <div className={'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ' + (TONES[it.tone] || TONES.teal)}>
                  <Icon name={it.icon} className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={(expanded ? '' : 'truncate ') + 'text-sm font-semibold text-white'}>{it.title}</p>
                  <p className={(expanded ? '' : 'truncate ') + 'text-xs text-gray-500'}>{it.sub}</p>
                </div>
                <AgePill at={it.at} atText={it.atText} />
              </div>
              {/* Full-width, 44px-tall actions on phones (comfortable thumb targets); compact inline buttons from sm+. */}
              <div className="flex w-full gap-4 sm:w-auto sm:flex-shrink-0">
                {it.actions.map((a, i) => (
                  a.to ? (
                    <Link
                      key={a.label}
                      to={a.to}
                      onClick={(e) => e.stopPropagation()}
                      className="flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg bg-teal-500/90 px-4 text-xs font-semibold text-white transition hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 sm:flex-none"
                    >
                      {a.icon ? <Icon name={a.icon} className="h-3.5 w-3.5" /> : null}
                      {a.label}
                    </Link>
                  ) : (
                    <button
                      key={a.label}
                      disabled={a.disabled || it.busy}
                      onClick={(e) => { e.stopPropagation(); a.onClick?.(); }}
                      className={
                        'flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg px-4 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 disabled:opacity-50 sm:flex-none ' +
                        (a.variant === 'ghost' || i > 0
                          ? 'bg-transparent text-gray-300 hover:bg-white/10'
                          : 'bg-teal-500/90 text-white hover:bg-teal-500')
                      }
                    >
                      {a.icon ? <Icon name={a.icon} className="h-3.5 w-3.5" /> : null}
                      {a.label}
                    </button>
                  )
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={onSeeAll}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-white/5 px-4 text-sm font-semibold text-gray-200 hover:bg-white/10"
        >
          See all {items.length}
        </button>
      ) : null}
    </Card>
  );
}
