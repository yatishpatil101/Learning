import { useState } from 'react';
import { Home, Building2, GitMerge, Undo2 } from 'lucide-react';
import { classNames } from '../../../lib/format.js';
import {
  CHIP, CHIP_TONE, ClearFilters, FactRow, PageNav, QueuePanel, RowCard, RowList, SearchBox, useClientPaging,
} from '../../../components/admin/WorkQueue.jsx';
import { titleCase, fmtDate, Chip, PLAIN, DUPES_FAILED } from './helpers.jsx';

export default function CandidatesTab({ candidates, merges, setMerge, openMerge, undoMerge, deciding, note }) {
  const [q, setQ] = useState('');
  const busy = (key) => !!deciding?.has(key);
  const needle = q.trim().toLowerCase();
  const rows = candidates.filter((s) => !needle || [s.name, s.localitySlug].join(' ').toLowerCase().includes(needle));
  const page = useClientPaging(rows, 10, q);

  /* Three branches, not two: rows minted before V108 have no provenance, and a confident "From a
     listing" on those would be the component guessing. A row with no recorded provenance says nothing. */
  const sourceChip = (s) => {
    if (s.mintOrigin === 'demand') return <span className={classNames(CHIP, CHIP_TONE.amber, 'gap-0.5')}><Home className="h-2.5 w-2.5" aria-hidden="true" />Searcher demand</span>;
    if (s.mintOrigin === 'listing') return <span className={classNames(CHIP, CHIP_TONE.sky, 'gap-0.5')}><Building2 className="h-2.5 w-2.5" aria-hidden="true" />From a listing</span>;
    return null;
  };

  /* Hints, not verdicts: `undefined` is "still checking" and `[]` is "nothing resembles it",
     so a failed check must not read as "No obvious match". */
  const dupeCell = (s) => {
    if (s.dupes === DUPES_FAILED) return <span className="text-amber-300">Could not check</span>;
    if (!s.dupes) return <span className="text-gray-500">Checking…</span>;
    if (!s.dupes.length) return <span className="text-gray-500">No obvious match</span>;
    return (
      <span className="flex flex-wrap gap-1">{s.dupes.slice(0, 3).map((d) => (
        <button key={d.slug} type="button" onClick={() => setMerge({ cand: s, target: d.slug, query: '' })} className="inline-flex">
          <Chip tone="bg-white/10 text-gray-300 hover:opacity-80">{d.name}</Chip>
        </button>
      ))}</span>
    );
  };

  return (
    <QueuePanel
      active="candidates"
      note={note}
      toolbar={(
        <>
          <SearchBox value={q} onChange={setQ} placeholder="Society or locality" label="Search candidates" />
          {q ? <ClearFilters onClick={() => setQ('')} /> : null}
          <div className="ml-auto"><PageNav {...page.paging} /></div>
        </>
      )}
      footer={page.paging.pageCount > 1 ? <PageNav {...page.paging} /> : null}
    >
      <RowList isEmpty={!rows.length} empty={q ? 'No candidates match this search.' : 'No community candidates awaiting review. Auto-minted societies land here.'}>
        {page.items.map((s) => (
          <RowCard
            key={s.slug}
            id={s.slug}
            title={s.name}
            badges={<><span className={classNames(CHIP, CHIP_TONE.neutral)}>Community</span>{sourceChip(s)}</>}
            meta={<><span className="capitalize">{titleCase(s.localitySlug) || '—'}</span><span className="text-gray-600" aria-hidden="true">·</span><span>Minted {fmtDate(s.createdAt)}</span></>}
            facts={(
              <FactRow label="Similar to">
                <span className="col-span-2 text-xs md:col-span-4">{dupeCell(s)}</span>
              </FactRow>
            )}
            primary={(
              <button type="button" onClick={() => openMerge(s)} disabled={busy(s.slug)} className={classNames(PLAIN, 'disabled:opacity-40')}><GitMerge className="h-3.5 w-3.5" />Merge</button>
            )}
          />
        ))}
      </RowList>
      {/* Merges in force: a merged-away society is invisible elsewhere, so without this list a merge could not be found and undone. */}
      {merges && merges.length ? (
        <div className="m-3 mt-0 rounded-xl border border-white/10 bg-white/5 p-3">
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
                <button type="button" onClick={() => undoMerge(m)} disabled={busy(m.slug)} className={classNames(PLAIN, 'shrink-0 disabled:opacity-40')}><Undo2 className="h-3.5 w-3.5" />Undo</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </QueuePanel>
  );
}
