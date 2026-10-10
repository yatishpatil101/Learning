import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, GitMerge } from 'lucide-react';
import { classNames } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import { useSocietySearch } from '../../lib/useSocietySearch.js';
import {
  listSocietyCandidates, listSocietyCandidateDuplicates,
  listSocietyMerges, mergeSocieties, undoSocietyMerge, getSocietiesSummary,
  getSocietyAdminView, editSociety, listSocietyDirectory,
} from '../../services/societyService.js';
import { ApiError, NetworkError } from '../../services/http.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { QueueTabs } from '../../components/admin/WorkQueue.jsx';
import useScrollLock from '../../hooks/useScrollLock.js';
import { titleCase, DUPES_FAILED } from './societies/helpers.jsx';
import CandidatesTab from './societies/CandidatesTab.jsx';
import DirectoryTab from './societies/DirectoryTab.jsx';

// 20, matching `GET /admin/societies`'s own `@PageableDefault`.
const DIR_PAGE_SIZE = 20;
const CAND_PAGE_SIZE = 10;

const NOTES = {
  candidates: 'Auto-minted societies (from listings & searcher demand). Merge duplicates into the canonical society — listings & followers redirect.',
  directory: 'Every society. Edits are stored as an overlay on the catalogue.',
};

export default function AdminSocieties() {
  const { toast } = useToast();
  const [tab, setTab] = useTabParam(['candidates', 'directory'], 'candidates');
  const [candidates, setCandidates] = useState({ items: [], total: 0 });
  const [merges, setMerges] = useState([]);
  const [counts, setCounts] = useState(null);
  // A failed fetch and a drained queue are indistinguishable on an empty table without this.
  const [queueErrors, setQueueErrors] = useState([]);
  const [bump, setBump] = useState(0);
  const [edit, setEdit] = useState(null); // { slug, ...form }
  const [merge, setMerge] = useState(null); // { cand, target, query }
  const [merging, setMerging] = useState(false);
  useScrollLock(Boolean(edit || merge));

  // Server-paged: `candQuery` is debounced into `candSearch`, and a new search resets to page 0.
  const [candQuery, setCandQuery] = useState('');
  const [candSearch, setCandSearch] = useState('');
  const [candPage, setCandPage] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => { setCandSearch(candQuery.trim()); setCandPage(0); }, 250);
    return () => clearTimeout(t);
  }, [candQuery]);

  // Only transport failures are absorbed: a mapper TypeError must not render as an empty queue.
  const safe = (p, label, empty, broke) => p.catch((err) => {
    if (!(err instanceof ApiError || err instanceof NetworkError)) throw err;
    console.warn(`[societies] The ${label} queue could not be loaded.`, err);
    broke.push(label);
    return empty;
  });

  // Tab badges: on arrival and after a decision, not on every tab or page change.
  useEffect(() => {
    let alive = true;
    getSocietiesSummary()
      .then((c) => { if (alive) setCounts(c); })
      .catch((err) => {
        if (!(err instanceof ApiError || err instanceof NetworkError)) throw err;
        console.warn('[societies] Tab counts could not be loaded.', err);
        if (alive) setCounts(null);
      });
    return () => { alive = false; };
  }, [bump]);

  useEffect(() => {
    if (tab !== 'candidates') return undefined;
    let alive = true;
    const broke = [];
    safe(listSocietyCandidates({ q: candSearch, page: candPage, size: CAND_PAGE_SIZE }), 'society candidates', { items: [], total: 0 }, broke)
      .then((res) => {
        if (!alive) return;
        setQueueErrors((prev) => [...prev.filter((l) => l !== 'society candidates'), ...broke]);
        // A merge can drain the last row of a page; step back rather than show an empty one.
        if (!res.items.length && candPage > 0 && !broke.length) { setCandPage(candPage - 1); return; }
        setCandidates({ items: res.items, total: res.total });
      });
    return () => { alive = false; };
  }, [tab, bump, candSearch, candPage]); // eslint-disable-line react-hooks/exhaustive-deps -- `safe` is redeclared every render and closes over nothing stateful.

  useEffect(() => {
    if (tab !== 'candidates') return undefined;
    let alive = true;
    const broke = [];
    safe(listSocietyMerges(), 'merges', [], broke).then((rows) => {
      if (!alive) return;
      setQueueErrors((prev) => [...prev.filter((l) => l !== 'merges'), ...broke]);
      setMerges(rows);
    });
    return () => { alive = false; };
  }, [tab, bump]); // eslint-disable-line react-hooks/exhaustive-deps -- as above.
  // Server-paged: `dirQuery` is debounced into `dirSearch`, and a new search resets to page 0.
  const [dirQuery, setDirQuery] = useState('');
  const [dirSearch, setDirSearch] = useState('');
  const [dirPage, setDirPage] = useState(0);
  const [dir, setDir] = useState({ status: 'loading', items: [], total: 0 });

  useEffect(() => {
    const t = setTimeout(() => { setDirSearch(dirQuery.trim()); setDirPage(0); }, 250);
    return () => clearTimeout(t);
  }, [dirQuery]);

  useEffect(() => {
    if (tab !== 'directory') return undefined;
    let alive = true;
    setDir((d) => ({ ...d, status: 'loading' }));
    listSocietyDirectory({ q: dirSearch, page: dirPage, size: DIR_PAGE_SIZE })
      .then((res) => { if (alive) setDir({ status: 'ready', items: res.items, total: res.total }); })
      // Never an empty list on failure: "No societies" and "could not read" are different sentences.
      .catch(() => { if (alive) setDir({ status: 'error', items: [], total: 0 }); });
    return () => { alive = false; };
  }, [tab, dirSearch, dirPage, bump]);

  // The duplicate hint is a request per row: four at a time, only for the page on screen, and cached until a decision.
  const [dupes, setDupes] = useState({});
  const dupesAsked = useRef(new Set());
  const dupesGen = useRef(0);

  useEffect(() => {
    dupesGen.current += 1;
    dupesAsked.current = new Set();
    setDupes({});
  }, [bump]);

  useEffect(() => {
    if (tab !== 'candidates') return undefined;
    const gen = dupesGen.current;
    const queue = candidates.items.map((c) => c.slug).filter((s) => s && !dupesAsked.current.has(s));
    queue.forEach((s) => dupesAsked.current.add(s));
    const keep = (slug, rows) => { if (gen === dupesGen.current) setDupes((prev) => ({ ...prev, [slug]: rows })); };

    const worker = async () => {
      for (let slug = queue.shift(); slug; slug = queue.shift()) {
        try {
          keep(slug, await listSocietyCandidateDuplicates(slug));
        } catch (err) {
          console.warn(`[societies] Could not check ${slug} for duplicates.`, err);
          keep(slug, DUPES_FAILED);
        }
      }
    };

    Promise.all([worker(), worker(), worker(), worker()]);
    // Hand unstarted slugs back now so the next run (same slugs, new page) scans them.
    return () => { queue.splice(0).forEach((s) => dupesAsked.current.delete(s)); };
  }, [tab, candidates]);

  const candidateRows = candidates.items.map((c) => ({ ...c, dupes: dupes[c.slug] }));

  const failed = (err, fallback) => toast(err?.message || fallback, 'error');

  // Ids with a decision in flight. The ref closes the double-click window the state Set cannot.
  const [deciding, setDeciding] = useState(() => new Set());
  const decidingRef = useRef(new Set());
  const withDeciding = async (id, run) => {
    if (decidingRef.current.has(id)) return;
    decidingRef.current.add(id);
    setDeciding((prev) => new Set(prev).add(id));
    try {
      await run();
    } finally {
      decidingRef.current.delete(id);
      setDeciding((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const openMerge = (cand) => setMerge({ cand, target: (cand.dupes && cand.dupes[0] && cand.dupes[0].slug) || '', query: '' });
  const confirmMerge = async () => {
    if (!merge || !merge.target) { toast('Pick a society to merge into.', 'error'); return; }
    if (merging) return;
    setMerging(true);
    try {
      await mergeSocieties(merge.cand.slug, merge.target);
    } catch (err) {
      // Verbatim: every refusal names the merge that has to be undone first.
      failed(err, 'Could not merge those two societies.');
      return;
    } finally {
      setMerging(false);
    }
    setMerge(null); setBump((n) => n + 1);
    toast('Duplicate merged — its listings, follows and reviews now read on the survivor', 'success');
  };
  // Undo is keyed by the society that was merged away: a survivor can have absorbed several.
  const undoMerge = (m) => withDeciding(m.slug, async () => {
    try {
      await undoSocietyMerge(m.slug);
    } catch (err) { failed(err, 'Could not undo that merge.'); return; }
    setBump((n) => n + 1);
    toast(`“${m.name}” stands on its own again`, 'info');
  });
  const { rows: mergeCandidates } = useSocietySearch(
    merge ? merge.query : '',
    merge ? titleCase(merge.cand.localitySlug) : '',
    !!merge,
  );
  const mergeResults = useMemo(() => {
    if (!merge) return [];
    return mergeCandidates.filter((r) => r.slug !== merge.cand.slug).slice(0, 8);
  }, [merge, mergeCandidates]);

  // Opens from the server's copy: `adminNote` is deliberately absent from the public payload.
  const openEdit = async (s) => {
    let row;
    try {
      row = await getSocietyAdminView(s.slug);
    } catch (err) { failed(err, 'Could not open that society.'); return; }
    setEdit({
      slug: row.slug, name: row.name,
      registration: row.registration, conveyance: row.conveyance,
      maintenancePerSqft: row.maintenancePerSqft ?? 3,
      adminNote: row.adminNote || '',
    });
  };
  const saveEdit = async () => {
    const patch = {
      registration: edit.registration, conveyance: edit.conveyance,
      maintenancePerSqft: Number(edit.maintenancePerSqft) || 0,
      adminNote: edit.adminNote.trim(),
    };
    // `adminNote` is sent even when empty: '' clears the note, absent leaves it.
    try {
      await editSociety(edit.slug, patch);
    } catch (err) { failed(err, 'Could not save that society.'); return; }
    setEdit(null); setBump((n) => n + 1);
    toast('Society details saved', 'success');
  };

  const tabs = [
    { key: 'candidates', label: 'Candidates', count: counts?.candidates ?? null },
    { key: 'directory', label: 'Directory', count: dir.status === 'ready' ? dir.total : null },
  ];

  const inp = 'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-teal-400/50';

  return (
    <div>
      <PageHeader title="Societies" subtitle="Merge duplicate societies & edit society profiles." />

      {queueErrors.length ? (
        <div role="alert" className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
          The {queueErrors.join(' and ')} {queueErrors.length > 1 ? 'queues' : 'queue'} could not be
          loaded, so {queueErrors.length > 1 ? 'those tabs are' : 'that tab is'} showing nothing
          rather than nothing to do.{' '}
          <button onClick={() => setBump((n) => n + 1)} className="underline underline-offset-2">Retry</button>
        </div>
      ) : null}

      <QueueTabs label="Society queues" active={tab} onChange={setTab} tabs={tabs} />

      {tab === 'candidates' ? (
        <CandidatesTab
          note={NOTES.candidates}
          candidates={candidateRows}
          total={candidates.total}
          query={candQuery}
          onQuery={setCandQuery}
          page={candPage}
          pageSize={CAND_PAGE_SIZE}
          onPage={setCandPage}
          merges={merges}
          setMerge={setMerge}
          openMerge={openMerge}
          undoMerge={undoMerge}
          deciding={deciding}
        />
      ) : null}
      {tab === 'directory' ? (
        <DirectoryTab
          note={NOTES.directory}
          state={dir}
          query={dirQuery}
          onQuery={setDirQuery}
          page={dirPage}
          pageSize={DIR_PAGE_SIZE}
          onPage={setDirPage}
          openEdit={openEdit}
        />
      ) : null}

      {edit && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgb(var(--dz-c-black) / .6)', backdropFilter: 'blur(4px)' }} onClick={() => setEdit(null)}>
          <div role="dialog" aria-modal="true" aria-label="Edit society" className="dz-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">{edit.name}</h3>
            <p className="text-gray-400 text-sm mb-4">Overlay edits — override the catalogue without touching source data.</p>
            <div className="space-y-3">
              <label className="flex items-center justify-between text-sm"><span>Registered</span>
                <input type="checkbox" checked={edit.registration} onChange={(e) => setEdit({ ...edit, registration: e.target.checked })} className="accent-teal-500 h-4 w-4" /></label>
              <label className="flex items-center justify-between text-sm"><span>Conveyance done</span>
                <input type="checkbox" checked={edit.conveyance} onChange={(e) => setEdit({ ...edit, conveyance: e.target.checked })} className="accent-teal-500 h-4 w-4" /></label>
              <label className="block text-sm">Maintenance (₹/sqft)
                <input type="number" min="0" value={edit.maintenancePerSqft} onChange={(e) => setEdit({ ...edit, maintenancePerSqft: e.target.value })} className={inp + ' mt-1'} /></label>
              <label className="block text-sm">Admin note
                <textarea rows={2} value={edit.adminNote} onChange={(e) => setEdit({ ...edit, adminNote: e.target.value })} className={inp + ' mt-1'} /></label>
            </div>
            <div className="mt-5 flex gap-2"><button onClick={() => setEdit(null)} className="btn-outline flex-1">Cancel</button><button onClick={saveEdit} className="btn-teal flex-1">Save</button></div>
          </div>
        </div>
      )}

      {merge && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgb(var(--dz-c-black) / .6)', backdropFilter: 'blur(4px)' }} onClick={() => setMerge(null)}>
          <div role="dialog" aria-modal="true" aria-label="Merge society" className="dz-card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2"><GitMerge className="h-5 w-5 text-brand-teal" />Merge duplicate</h3>
            <p className="text-gray-400 text-sm mb-4">Fold <span className="text-white font-semibold">“{merge.cand.name}”</span> into a canonical society. Its listings, follows and reviews will read on that society instead; nothing is deleted, and the merge can be undone.</p>
            <label className="block text-sm mb-1 text-gray-300">Merge into</label>
            <input autoFocus value={merge.query} onChange={(e) => setMerge({ ...merge, query: e.target.value })} placeholder="Search societies…" className={inp} />
            <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-white/10 divide-y divide-white/5">
              {mergeResults.length === 0 ? <div className="px-3 py-3 text-xs text-gray-500">No matches — try another name.</div> : mergeResults.map((r) => (
                <button key={r.slug} onClick={() => setMerge({ ...merge, target: r.slug })} className={classNames('flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5', merge.target === r.slug ? 'bg-brand-teal/10' : '')}>
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-white">{r.name}</span>
                    <span className="text-xs text-gray-400 capitalize">{titleCase(r.localitySlug)}</span>
                  </span>
                  {merge.target === r.slug ? <Check className="h-4 w-4 text-brand-teal" /> : null}
                </button>
              ))}
            </div>
            <div className="mt-5 flex gap-2"><button onClick={() => setMerge(null)} className="btn-outline flex-1">Cancel</button><button onClick={confirmMerge} disabled={!merge.target || merging} className="btn-teal flex-1 disabled:opacity-40">{merging ? 'Merging…' : 'Merge'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
