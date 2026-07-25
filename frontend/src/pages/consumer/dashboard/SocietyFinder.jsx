import { useMemo, useRef, useState } from 'react';
import { ShieldCheck, Plus, Bell, Check, Search } from 'lucide-react';
import { searchSocieties, mintDemandSociety, toggleFollowSociety, isSocietyFollowed } from '../../../lib/store.js';

/**
 * SocietyFinder — demand-side society capture for searchers.
 *
 * A searcher looks for a society and "follows" it to get alerted the moment a
 * home is listed there. If it doesn't exist yet, "Add & alert me" MINTS a
 * community society (source: 'demand') and auto-follows it — creating both the
 * society entity AND a demand signal ops can act on. Reuses the same follow +
 * auto-mint funnel as the listing side, so supply and demand grow one graph.
 */
const norm = (s) => String(s || '').trim().toLowerCase();

export default function SocietyFinder({ onFollow, autoFocus = false }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const inputRef = useRef(null);

  const results = useMemo(() => searchSocieties(query, ''), [query]);
  const exact = useMemo(() => results.find((r) => norm(r.name) === norm(query)) || null, [results, query]);
  const canCreate = query.trim().length >= 2 && !exact;

  const follow = (slug) => {
    if (!isSocietyFollowed(slug)) toggleFollowSociety(slug);
    // Notify the parent first so its refresh re-renders us; the row then reads
    // isSocietyFollowed() fresh and flips to "Following" (visible confirmation).
    if (onFollow) onFollow(slug);
  };

  const createAndFollow = () => {
    setBusy('create');
    const rec = mintDemandSociety({ name: query.trim() });
    setBusy('');
    if (!rec) return;
    setQuery('');
    if (onFollow) onFollow(rec.slug);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <Bell className="h-4 w-4 text-teal-400" /> Track a society
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Follow your target buildings — we’ll alert you the moment a home is listed. Can’t find it? Add it and we’ll notify you as soon as one appears.
      </p>

      <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:border-teal-400/50">
        <Search className="h-4 w-4 shrink-0 text-gray-500" />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={query}
          maxLength={60}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your society, e.g. Skyline Heights"
          className="w-full bg-transparent text-sm text-white placeholder-gray-500 outline-none"
        />
      </div>

      {query.trim().length >= 1 && (
        <div className="mt-2 overflow-hidden rounded-xl border border-white/10 divide-y divide-white/5">
          {results.map((s) => {
            const followed = isSocietyFollowed(s.slug);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => follow(s.slug)}
                disabled={followed}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-white/5 disabled:opacity-60"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-white">{s.name}</span>
                  {s.verified ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-teal-300" style={{ background: 'rgba(20,184,166,0.12)' }}><ShieldCheck className="h-3 w-3" /> Verified</span>
                  ) : s.community ? (
                    <span className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-amber-300" style={{ background: 'rgba(251,191,36,0.12)' }}>Unverified</span>
                  ) : null}
                  {s.localitySlug ? <span className="hidden shrink-0 truncate text-[11px] capitalize text-gray-500 sm:inline">{s.localitySlug.replace(/-/g, ' ')}</span> : null}
                </span>
                <span className={followed ? 'inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-teal-300' : 'inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-gray-400'}>
                  {followed ? <><Check className="h-3.5 w-3.5" /> Following</> : <><Bell className="h-3.5 w-3.5" /> Alert me</>}
                </span>
              </button>
            );
          })}

          {canCreate && (
            <button
              type="button"
              onClick={createAndFollow}
              disabled={busy === 'create'}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-teal-200 transition hover:bg-teal-500/10 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm font-medium">Add “{query.trim()}” &amp; alert me when a home is listed</span>
            </button>
          )}

          {results.length === 0 && !canCreate && (
            <div className="px-3 py-3 text-xs text-gray-500">Keep typing your society name…</div>
          )}
        </div>
      )}
    </div>
  );
}
