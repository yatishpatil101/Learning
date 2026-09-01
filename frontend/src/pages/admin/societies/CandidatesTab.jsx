import { Home, Building2, BadgeCheck, Sparkles, GitMerge, Undo2 } from 'lucide-react';
import Table from '../../../components/ui/Table.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { classNames } from '../../../lib/format.js';
import { titleCase, fmtDate, Chip, actBtn, TEAL, PLAIN } from './helpers.jsx';

export default function CandidatesTab({ candidates, merges, suggestions, suggMap, setMerge, setReview, verifyCand, openMerge, undoMerge, deciding }) {
  const busy = (key) => !!deciding?.has(key);
  /*
   * `suggMap` holds every pending detail suggestion for a society, not one. Two residents can file
   * against the same building, and the old single-valued map silently kept only the last — the
   * other suggestion was unreachable from the row that should surface it. The button opens the
   * oldest (the queue is oldest-first) and says how many are waiting behind it.
   */
  const reviewBtn = (s) => {
    const pending = suggMap[s.slug];
    if (!pending || !pending.length) return null;
    const label = pending.length > 1 ? `Review details (${pending.length})` : 'Review details';
    return actBtn(label, 'border-amber-400/30 bg-amber-500/10 text-amber-200', () => setReview(pending[0]));
  };

  /* Three branches, not two. This read `source === 'demand' ? demand : listing`, which is only
     sound while every row has a provenance — and none minted before V108 does. Against the server
     the two-branch form renders a confident "From a listing" on every unknown row, which is the
     worst of the three answers: the operator is being told where the building came from by a
     component that does not know. A row with no recorded provenance now says nothing. */
  const sourceChip = (s) => {
    if (s.mintOrigin === 'demand') return <Chip tone="bg-amber-500/15 text-amber-200" icon={<Home className="h-3 w-3" />}>Searcher demand</Chip>;
    if (s.mintOrigin === 'listing') return <Chip tone="bg-sky-500/15 text-sky-200" icon={<Building2 className="h-3 w-3" />}>From a listing</Chip>;
    return null;
  };

  const dupeChips = (s) => (
    <div className="flex flex-wrap gap-1">{s.dupes.slice(0, 3).map((d) => (
      <button key={d.slug} onClick={() => setMerge({ cand: s, target: d.slug, query: '' })} className="inline-flex">
        <Chip tone={classNames('hover:opacity-80', d.verified ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/10 text-gray-300')} icon={d.verified ? <BadgeCheck className="h-3 w-3" /> : null}>{d.name}</Chip>
      </button>))}</div>
  );

  const rowActions = (s) => (
    <>
      {reviewBtn(s)}
      {actBtn('Verify', TEAL, () => verifyCand(s), busy(s.slug))}
      <button onClick={() => openMerge(s)} disabled={busy(s.slug)} className={classNames('inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs disabled:opacity-40', PLAIN)}><GitMerge className="h-3 w-3" />Merge</button>
    </>
  );

  const candCols = [
    { key: 'name', header: 'Society', render: (s) => (
      <div>
        <div className="font-semibold">{s.name}</div>
        <div className="text-xs text-gray-400 capitalize">{titleCase(s.localitySlug) || '—'} · {fmtDate(s.createdAt)}</div>
      </div>
    ) },
    { key: 'source', header: 'Source', render: (s) => sourceChip(s) },
    /* "Possible", and the word is doing work. These are computed in the page from name-token overlap
       against the catalogue, not served — the server returns societies, and a society does not know
       which others look like it. Nothing here decides anything: the chip opens the merge dialog
       with that society pre-picked, and the operator can change it or search for another. */
    { key: 'dupes', header: 'Possible duplicates', render: (s) => (
      s.dupes && s.dupes.length
        ? dupeChips(s)
        : <span className="text-xs text-gray-500">No obvious match</span>
    ) },
    { key: 'status', header: 'Status', render: () => <Badge status="pending">Community</Badge> },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (s) => (
      <div className="flex flex-wrap gap-1">
        {rowActions(s)}
      </div>
    ) },
  ];

  const candCard = (s) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{s.name}</div>
          <div className="mt-0.5 text-xs text-gray-400 capitalize">{titleCase(s.localitySlug) || '—'} · {fmtDate(s.createdAt)}</div>
        </div>
        <Badge status="pending">Community</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {sourceChip(s)}
      </div>
      {s.dupes && s.dupes.length ? (
        <div className="mt-2">
          <div className="mb-1 text-[11px] text-gray-500">Possible duplicates</div>
          {dupeChips(s)}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
        {rowActions(s)}
      </div>
    </div>
  );

  // Suggestions whose society is not already a row in the candidates table below.
  const orphanSuggestions = suggestions.filter((s) => !candidates.some((c) => c.slug === s.slug));

  return (
    <>
      {orphanSuggestions.length ? (
        <div className="mb-4 rounded-xl border border-amber-400/20 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-200"><Sparkles className="h-3.5 w-3.5" /> <h4 className="inline">Community detail suggestions (society not in queue above)</h4></div>
          <div className="flex flex-col gap-1.5">
            {orphanSuggestions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                <div className="min-w-0"><div className="truncate text-sm font-medium text-white">{s.name}</div><div className="text-xs text-gray-400 capitalize">{titleCase(s.localitySlug) || '—'} · {fmtDate(s.at)}</div></div>
                {actBtn('Review details', 'border-amber-400/30 bg-amber-500/10 text-amber-200', () => setReview(s))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <Table columns={candCols} rows={candidates} rowKey={(s) => s.slug} pageSize={10} label="candidates" empty="No community candidates awaiting review. Auto-minted societies land here." mobileCard={candCard} />
      {/*
        Merges in force, below the queue and not beside it — a record of decisions taken rather than
        work waiting, which is also why it is newest-first while the queue above is oldest-first.

        It exists because a merged-away society is invisible everywhere else: it is gone from the
        directory, gone from this queue, and its slug resolves to the survivor. Without this list a
        merge could be made but never found, and so never undone — which on the one ops action whose
        input is two rows differing by a typo is the difference between a mistake and a permanent
        one. Rendered only when there is something in it, so an operator who has never merged
        anything is not shown an empty table explaining a feature they have not used.
      */}
      {merges && merges.length ? (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-300"><GitMerge className="h-3.5 w-3.5" /> <h4 className="inline">Merged duplicates</h4></div>
          <div className="flex flex-col gap-1.5">
            {merges.map((m) => (
              <div key={m.slug} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                <div className="min-w-0 text-sm">
                  <span className="text-gray-400 line-through">{m.name}</span>
                  <span className="mx-1.5 text-gray-500">→</span>
                  <span className="font-medium text-white">{m.intoName}</span>
                  <div className="text-[11px] text-gray-500">Merged {fmtDate(m.mergedAt)}</div>
                </div>
                <button
                  onClick={() => undoMerge(m)}
                  disabled={busy(m.slug)}
                  className={classNames('inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs disabled:opacity-40', PLAIN)}
                ><Undo2 className="h-3 w-3" />Undo</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
