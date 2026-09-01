import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Sparkles, AlertTriangle } from 'lucide-react';
import { fmtNum, classNames } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import { listLocalities, getLocalityQueue, assignLocality } from '../../services/localityService.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';

const fmtDate = (ts) => { try { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ''; } };
const coordStr = (l) => (l.lat != null && l.lng != null ? `${(+l.lat).toFixed(4)}, ${(+l.lng).toFixed(4)}` : '—');

/**
 * Localities — the curation queue, and the directory it files into.
 *
 * ## What this screen used to be
 *
 * Its Pending tab listed `pnCommunityLocalities`: areas the *browser* had minted when a lister
 * typed something the catalogue did not recognise. Two things were wrong with that, and they
 * compounded.
 *
 * The queue was one machine's `localStorage`, so a listing waiting on a human decision was
 * invisible to every operator but the one whose browser happened to have seen it. Everyone else
 * opened this page, saw nothing pending, and reasonably concluded there was nothing to do.
 *
 * And the object under review was the wrong one. Minting a locality from free text creates a
 * second, unvetted tier of areas — "Undhera Wasti", "undhera wasti " and "Undhera-Wasti" become
 * three localities — while the listing that caused it sails on. The listing is what is broken: with
 * no `localitySlug` it is missing from locality search facets, from `/locality/{slug}`, from
 * saved-search alerts and from its society's home list, however prominently it appears elsewhere.
 *
 * So the queue is now *listings whose locality could not be resolved*, read from the server, and
 * the fix is to file each one under an area that already exists. The community tier is gone.
 *
 * ## Why there is no Dismiss
 *
 * There was one, and it was the quiet half of the bug: it marked a locality reviewed while leaving
 * the listing exactly as unfiled as before. "Looked at it, still has no locality" is precisely the
 * state this queue exists to end. The two honest ways out of a row are to file it under an existing
 * area, or — if the area genuinely is missing from the catalogue — to add it in Content ▸
 * Localities and then file it. A listing that is not real gets rejected in Moderation.
 *
 * That is enforced upstream rather than here: the server refuses to approve a listing with no
 * locality. This page is what makes that refusal fair rather than a wall.
 *
 * ## Both tabs read the seam
 *
 * The directory used to render the bundled `data/localities.js`, which is a build artefact — an
 * area added through the admin console did not appear here until someone shipped a release. Both
 * tabs now read `listLocalities()`, so the set an operator can assign from is the same set the
 * console curates and the same set the server will accept.
 */
export default function AdminLocalities() {
  const { toast } = useToast();
  const [tab, setTab] = useTabParam(['pending', 'directory'], 'pending');
  const [queue, setQueue] = useState({ total: 0, listings: [] });
  const [directory, setDirectory] = useState([]);
  const [choice, setChoice] = useState({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [q, d] = await Promise.all([getLocalityQueue(), listLocalities()]);
      setQueue(q);
      setDirectory(d);
    } catch (e) {
      toast(e?.message || 'Could not load localities', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { reload(); }, [reload]);

  /* Active only, and alphabetical. A retired area is refused by the server anyway — offering one
     would be inviting a choice that cannot be honoured. */
  const assignable = useMemo(
    () => directory.filter((l) => l.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [directory],
  );

  /* The rows a buyer is being failed by *now*: already published, and absent from every locality
     surface. A pending one is only about to be. Surfaced as its own number because it is the
     backlog figure that should be zero, where the total legitimately never is. */
  const liveAndUnfindable = queue.listings.filter((l) => l.status === 'approved').length;

  const assign = async (row) => {
    const slug = choice[row.id];
    if (!slug) { toast('Pick an area first', 'info'); return; }
    setBusy(row.id);
    try {
      await assignLocality(row.id, slug);
      const name = (assignable.find((l) => l.slug === slug) || {}).name || slug;
      toast(`“${row.title}” filed under ${name}`, 'success');
      await reload();
    } catch (e) {
      // The server distinguishes "already filed", "area retired" and "no such area", and each is a
      // different repair. Passing its sentence through rather than replacing it with "Could not
      // assign" is the difference between knowing what to do next and reloading.
      toast(e?.message || 'Could not file that listing', 'error');
    } finally {
      setBusy('');
    }
  };

  const assignControl = (row) => (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={`Locality for ${row.title}`}
        value={choice[row.id] || ''}
        onChange={(e) => setChoice((c) => ({ ...c, [row.id]: e.target.value }))}
        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-gray-100"
      >
        <option value="">Choose area…</option>
        {assignable.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
      </select>
      <button
        onClick={() => assign(row)}
        disabled={busy === row.id}
        className="rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal disabled:opacity-50"
      >
        {busy === row.id ? 'Filing…' : 'Assign'}
      </button>
    </div>
  );

  const queueCols = [
    { key: 'title', header: 'Listing', render: (l) => (
      <div>
        <div className="font-semibold">{l.title}</div>
        <div className="text-xs text-gray-400">{l.id}{l.createdAt ? ` · ${fmtDate(l.createdAt)}` : ''}</div>
      </div>
    ) },
    /* The free text the owner typed is the field that makes the row decidable — it is the thing
       that failed to resolve. Without it a curator has a title and a pin, and is guessing. */
    { key: 'typed', header: 'Owner typed', render: (l) => (
      <span className="text-xs text-gray-200">{l.locality || <span className="text-gray-500">— nothing —</span>}</span>
    ) },
    { key: 'coords', header: 'Pin', render: (l) => <span className="text-xs text-gray-300">{coordStr(l)}</span> },
    { key: 'status', header: 'Status', render: (l) => <Badge status={l.status}>{l.status === 'approved' ? 'Live · unfindable' : l.status}</Badge> },
    { key: 'actions', header: 'File under', className: 'whitespace-nowrap', render: assignControl },
  ];

  const dirCols = [
    { key: 'name', header: 'Locality', render: (l) => <div><div className="font-semibold">{l.name}</div><div className="text-xs text-gray-400">{l.slug}</div></div> },
    { key: 'coords', header: 'Pin', render: (l) => <span className="text-xs text-gray-300">{coordStr(l)}</span> },
    { key: 'listings', header: 'Listings', render: (l) => <span className="text-xs text-gray-300">{fmtNum(l.listingCount || 0)}</span> },
    { key: 'active', header: 'Status', render: (l) => <Badge status={l.active === false ? 'rejected' : 'approved'}>{l.active === false ? 'Retired' : 'Live'}</Badge> },
  ];

  /* Stacked-card fallback below `sm` (see Table.jsx). The assign control keeps its 44px target. */
  const queueCard = (l) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{l.title}</div>
          <div className="mt-0.5 text-xs text-gray-400">Owner typed: {l.locality || '— nothing —'}</div>
        </div>
        <div className="shrink-0"><Badge status={l.status}>{l.status === 'approved' ? 'Live' : l.status}</Badge></div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
        <span>{coordStr(l)}</span>
        {l.createdAt ? (<><span className="text-gray-600">·</span><span>{fmtDate(l.createdAt)}</span></>) : null}
      </div>
      <div className="mt-3 border-t border-white/5 pt-3">{assignControl(l)}</div>
    </div>
  );

  const dirCard = (l) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{l.name}</div>
          <div className="mt-0.5 text-xs text-gray-400">{l.slug}</div>
        </div>
        <div className="shrink-0"><Badge status={l.active === false ? 'rejected' : 'approved'}>{l.active === false ? 'Retired' : 'Live'}</Badge></div>
      </div>
      <div className="mt-2.5 text-xs text-gray-400">{coordStr(l)} · {fmtNum(l.listingCount || 0)} listings</div>
    </div>
  );

  const KPIS = [
    { label: 'Awaiting a locality', value: fmtNum(queue.total), icon: Sparkles, tab: 'pending' },
    { label: 'Live and unfindable', value: fmtNum(liveAndUnfindable), icon: AlertTriangle, tab: 'pending' },
    { label: 'Localities', value: fmtNum(directory.length), icon: MapPin, tab: 'directory' },
  ];

  const rows = tab === 'pending' ? queue.listings : directory;
  const cols = tab === 'pending' ? queueCols : dirCols;
  const empty = tab === 'pending'
    ? 'Nothing awaiting a locality. Every listing is filed under an area buyers can search.'
    : 'No localities.';

  return (
    <div>
      <PageHeader title="Localities" subtitle="File listings the catalogue could not place, and keep the area registry honest." />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {KPIS.map((k) => (
          <div key={k.label} onClick={() => setTab(k.tab)} className="pn-card p-4 cursor-pointer hover:bg-white/5">
            <div className="flex items-start justify-between">
              <div><div className="text-xs text-gray-400">{k.label}</div><div className="mt-1 text-2xl font-extrabold">{k.value}</div></div>
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-teal/15 text-brand-teal"><k.icon className="h-4 w-4" /></span>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {[['pending', 'Awaiting Locality'], ['directory', 'Directory']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={classNames('flex-1 rounded-lg px-4 py-2 text-sm font-medium transition', tab === id ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:text-white')}>
            {label}
          </button>
        ))}
      </div>

      <p className="mb-2 text-xs text-gray-400">
        {tab === 'pending'
          ? 'Listings whose owner typed an area the catalogue does not recognise. Until one is filed it is missing from locality search, its locality page, saved-search alerts and its society — and it cannot be approved. If the area is genuinely new, add it in Content ▸ Localities first.'
          : 'Every area search, filters and SEO key off. Add and retire areas in Content ▸ Localities.'}
      </p>

      {/* `queue.total`, not `queue.listings.length`: the server caps the array at 200, and a console
          that rendered the cap would show a number that never moved on a real backlog. */}
      {tab === 'pending' && queue.total > queue.listings.length ? (
        <p className="mb-2 text-xs text-amber-300">
          Showing the {fmtNum(queue.listings.length)} most urgent of {fmtNum(queue.total)}. File these and reload for the next batch.
        </p>
      ) : null}

      <Table
        columns={cols}
        rows={loading ? [] : rows}
        rowKey={(l) => l.id || l.slug}
        pageSize={10}
        label={tab}
        empty={loading ? 'Loading…' : empty}
        mobileCard={tab === 'pending' ? queueCard : dirCard}
      />
    </div>
  );
}
