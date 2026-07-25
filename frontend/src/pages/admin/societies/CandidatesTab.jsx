import { Home, Building2, BadgeCheck, Sparkles, GitMerge } from 'lucide-react';
import Table from '../../../components/ui/Table.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { classNames } from '../../../lib/format.js';
import { titleCase, fmtDate, Chip, actBtn, TEAL, PLAIN } from './helpers.jsx';

export default function CandidatesTab({ candidates, suggestions, suggMap, setMerge, setReview, verifyCand, openMerge }) {
  const candCols = [
    { key: 'name', header: 'Society', render: (s) => (
      <div>
        <div className="font-semibold">{s.name}</div>
        <div className="text-xs text-gray-400 capitalize">{titleCase(s.localitySlug) || '—'} · {fmtDate(s.at)}</div>
      </div>
    ) },
    { key: 'source', header: 'Source', render: (s) => (
      s.source === 'demand'
        ? <Chip tone="bg-amber-500/15 text-amber-200" icon={<Home className="h-3 w-3" />}>Searcher demand</Chip>
        : <Chip tone="bg-sky-500/15 text-sky-200" icon={<Building2 className="h-3 w-3" />}>From a listing</Chip>
    ) },
    { key: 'dupes', header: 'Possible duplicates', render: (s) => (
      s.dupes && s.dupes.length
        ? <div className="flex flex-wrap gap-1">{s.dupes.slice(0, 3).map((d) => (
            <button key={d.slug} onClick={() => setMerge({ cand: s, target: d.slug, query: '' })} className="inline-flex">
              <Chip tone={classNames('hover:opacity-80', d.verified ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/10 text-gray-300')} icon={d.verified ? <BadgeCheck className="h-3 w-3" /> : null}>{d.name}</Chip>
            </button>))}</div>
        : <span className="text-xs text-gray-500">No obvious match</span>
    ) },
    { key: 'status', header: 'Status', render: () => <Badge status="pending">Community</Badge> },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (s) => (
      <div className="flex flex-wrap gap-1">
        {suggMap[s.slug] ? actBtn('Review details', 'border-amber-400/30 bg-amber-500/10 text-amber-200', () => setReview(suggMap[s.slug])) : null}
        {actBtn('Verify', TEAL, () => verifyCand(s))}
        <button onClick={() => openMerge(s)} className={classNames('inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs', PLAIN)}><GitMerge className="h-3 w-3" />Merge</button>
      </div>
    ) },
  ];

  const candCard = (s) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{s.name}</div>
          <div className="mt-0.5 text-xs text-gray-400 capitalize">{titleCase(s.localitySlug) || '—'} · {fmtDate(s.at)}</div>
        </div>
        <Badge status="pending">Community</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {s.source === 'demand'
          ? <Chip tone="bg-amber-500/15 text-amber-200" icon={<Home className="h-3 w-3" />}>Searcher demand</Chip>
          : <Chip tone="bg-sky-500/15 text-sky-200" icon={<Building2 className="h-3 w-3" />}>From a listing</Chip>}
      </div>
      {s.dupes && s.dupes.length ? (
        <div className="mt-2">
          <div className="mb-1 text-[11px] text-gray-500">Possible duplicates</div>
          <div className="flex flex-wrap gap-1">{s.dupes.slice(0, 3).map((d) => (
            <button key={d.slug} onClick={() => setMerge({ cand: s, target: d.slug, query: '' })} className="inline-flex">
              <Chip tone={classNames('hover:opacity-80', d.verified ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/10 text-gray-300')} icon={d.verified ? <BadgeCheck className="h-3 w-3" /> : null}>{d.name}</Chip>
            </button>))}</div>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
        {suggMap[s.slug] ? actBtn('Review details', 'border-amber-400/30 bg-amber-500/10 text-amber-200', () => setReview(suggMap[s.slug])) : null}
        {actBtn('Verify', TEAL, () => verifyCand(s))}
        <button onClick={() => openMerge(s)} className={classNames('inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs', PLAIN)}><GitMerge className="h-3 w-3" />Merge</button>
      </div>
    </div>
  );

  return (
    <>
      {suggestions.filter((s) => !candidates.some((c) => c.slug === s.slug)).length ? (
        <div className="mb-4 rounded-xl border border-amber-400/20 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-200"><Sparkles className="h-3.5 w-3.5" /> <h4 className="inline">Community detail suggestions (society not in queue above)</h4></div>
          <div className="flex flex-col gap-1.5">
            {suggestions.filter((s) => !candidates.some((c) => c.slug === s.slug)).map((s) => (
              <div key={s.slug} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                <div className="min-w-0"><div className="truncate text-sm font-medium text-white">{s.name}</div><div className="text-xs text-gray-400 capitalize">{titleCase(s.localitySlug) || '—'} · {fmtDate(s.at)}</div></div>
                {actBtn('Review details', 'border-amber-400/30 bg-amber-500/10 text-amber-200', () => setReview(s))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <Table columns={candCols} rows={candidates} rowKey={(s) => s.slug} pageSize={10} label="candidates" empty="No community candidates awaiting review. Auto-minted societies land here." mobileCard={candCard} />
    </>
  );
}
