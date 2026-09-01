import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Archive, Edit2, Megaphone, Plus, RotateCcw, Star } from 'lucide-react';
import { listReviews, mutateDb, archiveRecord, restoreRecord, addInternalNote } from '../../lib/mockApi.js';
import { listContent, createContent, updateContent, archiveContent, restoreContent } from '../../services/adminContentService.js';
import { classNames } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import Switch from '../../components/ui/Switch.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Table from '../../components/ui/Table.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Loading from '../../components/ui/Loading.jsx';

const TABS = [['banners', 'Banners'], ['faqs', 'FAQs'], ['announcements', 'Announcements'], ['reviews', 'Reviews']];

/** Reviews are not a CMS type and still live in the browser store; this writes that one list. */
function saveCollection(col, list) {
  mutateDb((db) => { db[col] = list; });
}

// The blanks are the server's fields, not the store's.
//
// Banners lost `sub`, `cta` and `theme`; announcements lost `audience`; FAQs lost `active`. None of
// those exist on the API, no consumer surface ever rendered a mock banner or announcement, and a
// console that keeps offering a field the server will not store is a console that quietly loses
// work. Announcements gained `severity` and a schedule window, which is the more useful half of
// what `audience` was being asked to imply.
const BLANK_BANNER = { headline: '', image: '', link: '/listings', position: 0 };
const BLANK_FAQ = { question: '', answer: '', category: 'general' };
const BLANK_ANN = { title: '', body: '', severity: 'info', active: true };

/** Modal kind -> the API's `{type}` path segment. */
const TYPE_OF = { banner: 'banners', faq: 'faqs', announcement: 'announcements' };

/** Map tab id → feature-flag dot-path (null = always visible) */
const TAB_FLAG_MAP = {
  banners: 'content.banners',
  faqs: 'content.faqs',
  announcements: 'content.announcements',
  reviews: 'content.reviews',
};

export default function AdminContent() {
  const { toast } = useToast();
  const { optionEnabled, loading: flagsLoading } = useAdminFlags();
  const [tab, setTab] = useTabParam(['banners', 'faqs', 'announcements', 'reviews'], 'banners');
  const [loaded, setLoaded] = useState(false);
  const [banners, setBanners] = useState([]);
  const [anns, setAnns] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [editModal, setEditModal] = useState(null);
  const [editData, setEditData] = useState({});

  const visibleTabs = useMemo(
    () => TABS.filter(([id]) => {
      const flag = TAB_FLAG_MAP[id];
      return flag === null || optionEnabled(flag);
    }),
    [optionEnabled],
  );

  // The localities list used to be loaded here purely to gate the spinner; its own tab moved to
  // Analytics long ago and nothing on this page has read it since. The gate is now a plain boolean.
  useEffect(() => {
    let alive = true;
    Promise.all([
      listContent('banners'),
      listContent('announcements'),
      listContent('faqs'),
      listReviews({ includeArchived: true }),
    ]).then(([b, a, f, r]) => {
      if (!alive) return;
      setBanners(b || []);
      setAnns(a || []);
      setFaqs(f || []);
      setReviews(r || []);
      setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const activeBanners = useMemo(() => banners.filter((b) => !b.archived), [banners]);
  const archivedBanners = useMemo(() => banners.filter((b) => b.archived), [banners]);
  const activeFaqs = useMemo(() => faqs.filter((f) => !f.archived), [faqs]);
  const archivedFaqs = useMemo(() => faqs.filter((f) => f.archived), [faqs]);
  const activeAnns = useMemo(() => anns.filter((a) => !a.archived), [anns]);
  const archivedAnns = useMemo(() => anns.filter((a) => a.archived), [anns]);
  const activeReviews = useMemo(() => reviews.filter((r) => !r.archived), [reviews]);
  const archivedReviews = useMemo(() => reviews.filter((r) => r.archived), [reviews]);

  if (!loaded || flagsLoading) return <Loading />;

  if (!optionEnabled('content.enabled')) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-gray-500 text-sm">Content module is disabled.</div>
        <Link to="/admin/settings" className="mt-2 text-brand-teal text-sm hover:underline">Enable in Settings &rarr;</Link>
      </div>
    );
  }

  // ---- Helpers ----
  const openAdd = (kind, blank) => { setEditModal({ kind, isNew: true }); setEditData({ ...blank }); };
  const openEdit = (kind, item) => { setEditModal({ kind, isNew: false, id: item.id }); setEditData({ ...item }); };
  const closeMod = () => { setEditModal(null); setEditData({}); };

  // Every write below replaces the row the server returns rather than the row the form held. The
  // form does not know the id, the created timestamp or what the server normalised, and guessing
  // any of the three is how a console starts disagreeing with the database it is editing.
  //
  // `logAudit` used to be called after each of these. It is gone: the API writes the audit row
  // itself, from the authenticated principal, and a second entry composed in the browser was both
  // duplicate and less trustworthy than the one it duplicated.
  const saveItem = async (kind, setter) => {
    const type = TYPE_OF[kind];
    try {
      if (editModal.isNew) {
        const created = await createContent(type, editData);
        setter((prev) => [...prev, created]);
      } else {
        const updated = await updateContent(type, editModal.id, editData);
        setter((prev) => prev.map((x) => (x.id === editModal.id ? updated : x)));
      }
      toast('Saved');
      closeMod();
    } catch (err) {
      // The server names the offending field ("A banners item needs 'image'"), and that is far more
      // use to an editor than "Could not save". Fall back only when there is nothing to quote.
      toast(err?.message || 'Could not save. Please try again.', 'error');
    }
  };

  const archiveItem = async (kind, setter, id) => {
    if (!window.confirm(`Archive this ${kind}? It will be hidden but preserved.`)) return;
    try {
      const updated = await archiveContent(TYPE_OF[kind], id);
      setter((prev) => prev.map((x) => (x.id === id ? updated : x)));
      toast('Archived');
    } catch {
      toast('Could not archive. Please try again.', 'error');
    }
  };

  const restoreItem = async (kind, setter, id) => {
    if (!window.confirm(`Restore this ${kind}?`)) return;
    try {
      const updated = await restoreContent(TYPE_OF[kind], id);
      setter((prev) => prev.map((x) => (x.id === id ? updated : x)));
      toast('Restored', 'success');
    } catch {
      toast('Could not restore. Please try again.', 'error');
    }
  };

  /**
   * Announcements are the only CMS type with an `active` flag. Banners and FAQs used to have one in
   * the browser store, but the API has no such column for either: withdrawing a banner or an answer
   * is archiving it. Two ways to hide the same row is one way too many, and the toggle was the one
   * that left no record of who hid it.
   */
  const toggleActive = async (item) => {
    try {
      const updated = await updateContent('announcements', item.id, { active: !item.active });
      setAnns((prev) => prev.map((x) => (x.id === item.id ? updated : x)));
    } catch {
      toast('Could not update. Please try again.', 'error');
    }
  };

  // ---- Reviews (still browser-side; not one of the four CMS types) ----
  const archiveReview = (id) => {
    if (!window.confirm('Archive this review? It will be hidden but preserved.')) return;
    const note = window.prompt('Internal note (optional):');
    archiveRecord('reviews', id, 'Archived by admin');
    if (note) addInternalNote('review', id, note, 'Archived');
    setReviews((prev) => prev.map((x) => (x.id === id ? { ...x, archived: true, archivedAt: new Date().toISOString() } : x)));
    toast('Archived');
  };
  const restoreReview = (id) => {
    if (!window.confirm('Restore this review?')) return;
    restoreRecord('reviews', id);
    addInternalNote('review', id, '', 'Restored');
    setReviews((prev) => prev.map((x) => (x.id === id ? { ...x, archived: false } : x)));
    toast('Restored', 'success');
  };

  const reviewActions = (r) => (
    <>
      {r.status !== 'published' ? <button onClick={() => { setReviews((prev) => { const n = prev.map((x) => x.id===r.id ? {...x,status:'published'} : x); saveCollection('reviews', n); return n; }); toast('Approved'); }} className="rounded-lg border border-brand-teal/30 bg-brand-teal/10 px-2 py-1 text-xs text-brand-teal">Approve</button> : null}
      {r.status !== 'rejected' ? <button onClick={() => { setReviews((prev) => { const n = prev.map((x) => x.id===r.id ? {...x,status:'rejected'} : x); saveCollection('reviews', n); return n; }); toast('Rejected'); }} className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">Reject</button> : null}
      {r.archived
        ? <button onClick={() => restoreReview(r.id)} title="Restore" className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-1.5 text-emerald-300"><RotateCcw className="h-3.5 w-3.5" /></button>
        : <button onClick={() => archiveReview(r.id)} title="Archive" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-amber-500/10 hover:text-amber-300"><Archive className="h-3.5 w-3.5" /></button>}
    </>
  );

  const reviewCols = [
    { key: 'author', header: 'Author', render: (r) => <div><div className="font-semibold">{r.user || r.author || 'User'}</div><div className="text-xs text-gray-400">{r.target || '—'}</div></div> },
    { key: 'rating', header: 'Rating', render: (r) => <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 text-amber-400" />{r.rating || '—'}</span> },
    { key: 'text', header: 'Review', render: (r) => <span className="max-w-xs truncate text-sm">{r.text || r.body || '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status || 'pending'} /> },
    { key: 'actions', header: '', className: 'whitespace-nowrap', render: (r) => (
      <div className="flex gap-1">
        {reviewActions(r)}
      </div>
    ) },
  ];

  const reviewCard = (r) => (
    <div className="pn-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{r.user || r.author || 'User'}</div>
          <div className="truncate text-xs text-gray-400">{r.target || '—'}</div>
        </div>
        <div className="shrink-0 text-right">
          <span className="flex items-center justify-end gap-1 text-sm"><Star className="h-3.5 w-3.5 text-amber-400" />{r.rating || '—'}</span>
          <div className="mt-1"><Badge status={r.status || 'pending'} /></div>
        </div>
      </div>
      {(r.text || r.body) ? <div className="mt-2 text-sm text-gray-300">{r.text || r.body}</div> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
        {reviewActions(r)}
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Content" subtitle="Manage banners, FAQs, announcements and reviews." />

      <HScroll fadeColor="var(--brand-card, #1a1730)" wrapClassName="mb-5" className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {visibleTabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={classNames('flex-1 shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition', tab === id ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:text-white')}>
            {label}
          </button>
        ))}
      </HScroll>

      {/* ---- Localities ---- */}
      {/* Localities & City Demand moved to Analytics → Geography & Pricing tabs */}

      {/* ---- Banners ---- */}
      {tab === 'banners' ? (
        <div>
          <div className="mb-3 flex justify-between"><p className="text-xs text-gray-400">Promotional banners shown on the homepage hero. ({activeBanners.length} active, {archivedBanners.length} archived)</p><button onClick={() => openAdd('banner', BLANK_BANNER)} className="pn-btn pn-btn-primary"><Plus className="h-4 w-4" />Add banner</button></div>
          <div className="grid gap-3 md:grid-cols-2">
            {activeBanners.map((b) => (
              <div key={b.id} className="pn-card flex items-center justify-between gap-4 p-4">
                <div><div className="font-semibold">{b.headline || 'Untitled banner'}</div><div className="mt-0.5 text-xs text-gray-400">Links to {b.link || '—'} · position {b.position ?? '—'}</div></div>
                <div className="flex items-center gap-2">
                  <button onClick={() => openEdit('banner', b)} className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-white/5"><Edit2 className="h-3.5 w-3.5" /></button>
                  <button onClick={() => archiveItem('banner', setBanners, b.id)} title="Archive" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-amber-500/10 hover:text-amber-300"><Archive className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
            {!activeBanners.length ? <p className="text-sm text-gray-500">No banners yet.</p> : null}
          </div>
          {archivedBanners.length ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Archived</p>
              <div className="grid gap-3 md:grid-cols-2 opacity-60">
                {archivedBanners.map((b) => (
                  <div key={b.id} className="pn-card flex items-center justify-between gap-4 p-4 border-dashed">
                    <div><div className="font-semibold">{b.headline || 'Untitled banner'}</div><div className="mt-0.5 text-xs text-gray-500">Archived</div></div>
                    <button onClick={() => restoreItem('banner', setBanners, b.id)} title="Restore" className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-1.5 text-emerald-300"><RotateCcw className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- FAQs ---- */}
      {tab === 'faqs' ? (
        <div>
          <div className="mb-3 flex justify-between"><p className="text-xs text-gray-400">Frequently asked questions. ({activeFaqs.length} active)</p><button onClick={() => openAdd('faq', BLANK_FAQ)} className="pn-btn pn-btn-primary"><Plus className="h-4 w-4" />Add FAQ</button></div>
          <div className="space-y-2">
            {activeFaqs.map((f) => (
              <div key={f.id} className="pn-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="font-semibold">{f.question}</div><div className="mt-1 text-sm text-gray-400 line-clamp-2">{f.answer}</div></div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => openEdit('faq', f)} className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-white/5"><Edit2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => archiveItem('faq', setFaqs, f.id)} title="Archive" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-amber-500/10 hover:text-amber-300"><Archive className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </div>
            ))}
            {!activeFaqs.length ? <p className="text-sm text-gray-500">No FAQs yet.</p> : null}
          </div>
          {archivedFaqs.length ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Archived</p>
              <div className="space-y-2 opacity-60">
                {archivedFaqs.map((f) => (
                  <div key={f.id} className="pn-card p-4 border-dashed">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><div className="font-semibold">{f.question}</div></div>
                      <button onClick={() => restoreItem('faq', setFaqs, f.id)} title="Restore" className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-1.5 text-emerald-300"><RotateCcw className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- Announcements ---- */}
      {tab === 'announcements' ? (
        <div>
          <div className="mb-3 flex justify-between"><p className="text-xs text-gray-400">Internal/marketing announcements &amp; campaigns. ({activeAnns.length} active)</p><button onClick={() => openAdd('announcement', BLANK_ANN)} className="pn-btn pn-btn-primary"><Plus className="h-4 w-4" />New announcement</button></div>
          <div className="space-y-2">
            {activeAnns.map((a) => (
              <div key={a.id} className="pn-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><div className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-brand-teal" /><span className="font-semibold">{a.title}</span><span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs capitalize">{a.severity || 'info'}</span></div><div className="mt-1 text-sm text-gray-400 line-clamp-2">{a.body}</div></div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch checked={!!a.active} onChange={() => toggleActive(a)} label="Active" />
                    <button onClick={() => openEdit('announcement', a)} className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-white/5"><Edit2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => archiveItem('announcement', setAnns, a.id)} title="Archive" className="rounded-lg border border-white/10 p-1.5 text-gray-400 hover:bg-amber-500/10 hover:text-amber-300"><Archive className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </div>
            ))}
            {!activeAnns.length ? <p className="text-sm text-gray-500">No announcements yet.</p> : null}
          </div>
          {archivedAnns.length ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Archived</p>
              <div className="space-y-2 opacity-60">
                {archivedAnns.map((a) => (
                  <div key={a.id} className="pn-card p-4 border-dashed">
                    <div className="flex items-start justify-between gap-3">
                      <div><span className="font-semibold">{a.title}</span></div>
                      <button onClick={() => restoreItem('announcement', setAnns, a.id)} title="Restore" className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-1.5 text-emerald-300"><RotateCcw className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- Reviews ---- */}
      {tab === 'reviews' ? (
        <div>
          <p className="mb-3 text-xs text-gray-400">Moderate user reviews for localities and services. ({activeReviews.length} active, {archivedReviews.length} archived)</p>
          <Table columns={reviewCols} rows={activeReviews} pageSize={10} label="reviews" empty="No reviews yet." mobileCard={reviewCard} />
          {archivedReviews.length ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Archived reviews</p>
              <Table columns={reviewCols} rows={archivedReviews} pageSize={5} label="archived reviews" empty="" mobileCard={reviewCard} />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- Edit / Add modal ---- */}
      {editModal ? (
        <Modal open={true} onClose={closeMod} title={`${editModal.isNew ? 'Add' : 'Edit'} ${editModal.kind}`} size="md"
          footer={<><button onClick={closeMod} className="pn-btn pn-btn-ghost">Cancel</button>
            <button onClick={() => {
              if (editModal.kind === 'banner') saveItem('banner', setBanners);
              else if (editModal.kind === 'faq') saveItem('faq', setFaqs);
              else saveItem('announcement', setAnns);
            }} className="pn-btn pn-btn-primary">Save</button></>}
        >
          {editModal.kind === 'banner' ? (
            <div className="space-y-3">
              {[['headline', 'Headline'], ['image', 'Image URL'], ['link', 'Link']].map(([k, l]) => (
                <label key={k} className="block text-sm"><span className="mb-1 block text-gray-400">{l}</span>
                  <input value={editData[k] || ''} onChange={(e) => setEditData((d) => ({ ...d, [k]: e.target.value }))} className="pn-input" /></label>
              ))}
              <label className="block text-sm"><span className="mb-1 block text-gray-400">Position</span>
                <input type="number" value={editData.position ?? 0} onChange={(e) => setEditData((d) => ({ ...d, position: Number(e.target.value) }))} className="pn-input" /></label>
            </div>
          ) : editModal.kind === 'faq' ? (
            <div className="space-y-3">
              <label className="block text-sm"><span className="mb-1 block text-gray-400">Question</span>
                <input value={editData.question || ''} onChange={(e) => setEditData((d) => ({ ...d, question: e.target.value }))} className="pn-input" /></label>
              <label className="block text-sm"><span className="mb-1 block text-gray-400">Answer</span>
                <textarea rows={3} value={editData.answer || ''} onChange={(e) => setEditData((d) => ({ ...d, answer: e.target.value }))} className="pn-input" /></label>
              <label className="block text-sm"><span className="mb-1 block text-gray-400">Category</span>
                <input value={editData.category || ''} onChange={(e) => setEditData((d) => ({ ...d, category: e.target.value }))} className="pn-input" /></label>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm"><span className="mb-1 block text-gray-400">Title</span>
                <input value={editData.title || ''} onChange={(e) => setEditData((d) => ({ ...d, title: e.target.value }))} className="pn-input" /></label>
              <label className="block text-sm"><span className="mb-1 block text-gray-400">Body</span>
                <textarea rows={3} value={editData.body || ''} onChange={(e) => setEditData((d) => ({ ...d, body: e.target.value }))} className="pn-input" /></label>
              <label className="block text-sm"><span className="mb-1 block text-gray-400">Severity</span>
                <select value={editData.severity || 'info'} onChange={(e) => setEditData((d) => ({ ...d, severity: e.target.value }))} className="pn-input">
                  <option value="info">Info</option>
                  <option value="success">Success</option>
                  <option value="warning">Warning</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={!!editData.active} onChange={(v) => setEditData((d) => ({ ...d, active: v }))} label="Active" /><span className="text-gray-300">Active</span></label>
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
