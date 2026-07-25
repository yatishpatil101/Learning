import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Archive, ArrowUpRight, Building2, Check, CheckCircle2, Clock, Copy, Download, Flag, Star, X } from 'lucide-react';
import { listProperties, setListingStatus, toggleFeatured, logAudit, setPipelineStage, sendOwnerReminder, sendWhatsappTemplate } from '../../lib/mockApi.js';
import { flagListing, clearFlag, archiveListing, restoreListing, updateListingFields, ensureReview, getReview, markReviewRead, decideReview, findDuplicateClusters } from '../../lib/data/properties-admin.js';
import { submitNote } from '../../components/ui/InternalNote.jsx';
import { fmtNum, classNames } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { computeQualityScore, qualityLabel } from '../../lib/qualityScore.js';
import { freshnessState } from '../../lib/freshness.js';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { propertiesScope } from '../../lib/permissions.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useTabParam } from '../../lib/useTabParam.js';
import Select from '../../components/ui/Select.jsx';
import Loading from '../../components/ui/Loading.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import DateRangePills from '../../components/ui/DateRangePills.jsx';
import DealPills from '../../components/ui/DealPills.jsx';
import QualityPills from '../../components/ui/QualityPills.jsx';
import AdminPropertyCard from '../../components/admin/AdminPropertyCard.jsx';
import PipelineTab from './properties/PipelineTab.jsx';
import DuplicatesTab from './properties/DuplicatesTab.jsx';
import PropertyReviewModal from './properties/PropertyReviewModal.jsx';
import { PropertyEditModal, PropertyFlagModal, PropertyArchiveModal, PropertyViewModal, PropertyBulkRejectModal } from './properties/PropertyModals.jsx';
import { STATUS_OPTS, PAGE_LIMIT, KPI_TINTS, PIPELINE_STAGES, exportCsv } from './properties/constants.js';

const PaginationHint = ({ total }) =>
  total > PAGE_LIMIT ? (
    <p className="text-center text-xs text-gray-500 pt-2">Showing {PAGE_LIMIT} of {total} — use filters to narrow down</p>
  ) : null;

function KpiCard({ label, value, icon: Icon, tint, onClick }) {
  return (
    <button type="button" onClick={onClick} title={`View ${label} listings`} className="group pn-card p-4 sm:p-5 text-left transition hover:border-brand-teal/40 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-brand-teal/40">
      <div className="flex items-start justify-between">
        <span className={classNames('grid h-10 w-10 place-items-center rounded-xl', KPI_TINTS[tint])}><Icon className="h-5 w-5" /></span>
        <ArrowUpRight className="h-4 w-4 text-gray-500 transition group-hover:text-brand-teal" />
      </div>
      <div className="mt-3 text-2xl font-extrabold">{fmtNum(value)}</div>
      <div className="text-sm text-gray-400">{label} listings</div>
    </button>
  );
}

export default function AdminProperties() {
  const { toast } = useToast();
  const { optionEnabled, customRoles } = useAdminFlags();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [all, setAll] = useState(null);
  const [tab, setTab] = useTabParam(['all', 'pipeline', 'verify', 'followup', 'staff', 'flagged', 'featured', 'duplicates'], 'all');

  // Users scoped to Properties · Verify only see the module locked to the
  // Verification Queue (no curation, duplicates or listing management).
  const verifyOnly = propertiesScope(user, customRoles) === 'verify';
  const activeTab = verifyOnly ? 'verify' : tab;

  const [qAll, setQAll] = useState('');
  const [qVerify, setQVerify] = useState('');
  const [qFlagged, setQFlagged] = useState('');
  const [qFeatured, setQFeatured] = useState('');
  const [qStaff, setQStaff] = useState('');
  const [qFollowUp, setQFollowUp] = useState('');
  const [followUpSub, setFollowUpSub] = useState('all');
  const [dateRange, setDateRange] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fDeal, setFDeal] = useState('');
  const [fQuality, setFQuality] = useState('');

  const [selAll, setSelAll] = useState(() => new Set());
  const [selVer, setSelVer] = useState(() => new Set());

  const [review, setReview] = useState(null);
  const [edit, setEdit] = useState(null);
  const [flagFor, setFlagFor] = useState(null);
  const [flagReason, setFlagReason] = useState('');
  const [archiveFor, setArchiveFor] = useState(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [view, setView] = useState(null);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [internalNote, setInternalNote] = useState('');

  const refresh = () => listProperties({ includeAllStatuses: true, includeArchived: true }, 'newest').then(setAll);

  useEffect(() => {
    let alive = true;
    listProperties({ includeAllStatuses: true, includeArchived: true }, 'newest').then((rows) => { if (alive) setAll(rows); });
    return () => { alive = false; };
  }, []);

  // Deep-link handling — ?tab= is resolved by useTabParam; here we only open a review modal.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (!all || deepLinkHandled.current) return;
    const reviewId = params.get('review');
    if (reviewId) {
      const listing = all.find((l) => l.id === reviewId);
      if (listing) { setTab('verify'); setReview(listing); }
    }
    deepLinkHandled.current = true;
  }, [all, params]);

  const jumpTo = (t, status) => { setTab(t); if (t === 'all') { setQAll(''); setFDeal(''); setFStatus(status || ''); } };

  // ---- computed data ----
  const counts = useMemo(() => {
    const list = all || [];
    const c = { total: 0, approved: 0, pending: 0, flagged: 0, featured: 0 };
    list.forEach((l) => { if (l.archived) return; c.total++; if (l.status === 'approved') c.approved++; if (l.status === 'pending' || l.status === 'Under Review') c.pending++; if (l.status === 'flagged') c.flagged++; if (l.featured) c.featured++; });
    return c;
  }, [all]);

  // Number of distinct duplicate clusters awaiting an Ops merge decision.
  const dupCount = useMemo(() => findDuplicateClusters().length, [all]);

  const rowsAll = useMemo(() => {
    const list = all || [];
    const q = qAll.toLowerCase();
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => {
      if (q && !(l.title + l.owner + l.locality + l.id).toLowerCase().includes(q)) return false;
      if (fStatus === 'archived') {
        if (!l.archived) return false;
      } else {
        if (l.archived) return false;
        if (fStatus && l.status !== fStatus) return false;
      }
      if (cutoff && new Date(l.createdAt).getTime() < cutoff) return false;
      if (fDeal && l.deal !== fDeal) return false;
      if (fQuality && qualityLabel(computeQualityScore(l)) !== fQuality) return false;
      return true;
    });
  }, [all, qAll, fStatus, fDeal, dateRange, fQuality]);

  const rowsVerify = useMemo(() => {
    const list = all || [];
    const q = qVerify.toLowerCase();
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => (l.status === 'pending' || l.status === 'Under Review') && (!fDeal || l.deal === fDeal) && (!q || (l.title + l.owner + l.locality + l.id).toLowerCase().includes(q)) && (!cutoff || new Date(l.createdAt).getTime() >= cutoff));
  }, [all, qVerify, dateRange, fDeal]);

  const rowsFlagged = useMemo(() => {
    const list = all || [];
    const q = qFlagged.toLowerCase();
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => l.status === 'flagged' && (!fDeal || l.deal === fDeal) && (!q || (l.title + l.owner + l.locality + l.id).toLowerCase().includes(q)) && (!cutoff || new Date(l.createdAt).getTime() >= cutoff));
  }, [all, qFlagged, dateRange, fDeal]);

  const rowsFeatured = useMemo(() => {
    const list = all || [];
    const q = qFeatured.toLowerCase();
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => l.featured && (!fDeal || l.deal === fDeal) && (!q || (l.title + l.locality + l.id).toLowerCase().includes(q)) && (!cutoff || new Date(l.createdAt).getTime() >= cutoff));
  }, [all, qFeatured, dateRange, fDeal]);

  const rowsStaff = useMemo(() => {
    const list = all || [];
    const q = qStaff.toLowerCase();
    const cutoff = dateRange ? Date.now() - Number(dateRange) * 86400000 : 0;
    return list.filter((l) => l.postedByStaff && (!fDeal || l.deal === fDeal) && (!q || (l.title + l.owner + l.locality + l.postedByStaff + l.id).toLowerCase().includes(q)) && (!cutoff || new Date(l.createdAt).getTime() >= cutoff));
  }, [all, qStaff, dateRange, fDeal]);

  const { rowsFollowUp, rowsStale, rowsAwaiting } = useMemo(() => {
    const list = all || [];
    const now = Date.now();
    const q = qFollowUp.toLowerCase();
    const stale = [];
    const awaiting = [];
    list.forEach((l) => {
      if (l.status !== 'pending' && l.status !== 'Under Review') return;
      if (fDeal && l.deal !== fDeal) return;
      if (q && !(l.title + l.owner + l.locality + l.id).toLowerCase().includes(q)) return;
      const created = new Date(l.createdAt).getTime();
      const isStale = (now - created) > 48 * 60 * 60 * 1000;
      const isAwaitingOwner = l.postedByAdmin && (!l.photosUploaded || !l.aadhaarVerified);
      if (isAwaitingOwner) awaiting.push(l);
      else if (isStale) stale.push(l);
    });
    const byCreated = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
    stale.sort(byCreated);
    awaiting.sort(byCreated);
    return { rowsFollowUp: [...stale, ...awaiting], rowsStale: stale, rowsAwaiting: awaiting };
  }, [all, qFollowUp, fDeal]);

  const rowsUnconfirmed = useMemo(() => {
    const list = all || [];
    const q = qFollowUp.toLowerCase();
    return list
      .filter((l) => {
        if (!l.real || l.archived || l.status !== 'approved') return false;
        const st = freshnessState(l);
        if (st !== 'stale' && st !== 'dormant') return false;
        if (fDeal && l.deal !== fDeal) return false;
        if (q && !(l.title + l.owner + l.locality + l.id).toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => new Date(a.freshenedAt || a.createdAt) - new Date(b.freshenedAt || b.createdAt));
  }, [all, qFollowUp, fDeal]);

  const activeFollowUp =
    followUpSub === 'unconfirmed' ? rowsUnconfirmed :
    followUpSub === 'stale' ? rowsStale :
    followUpSub === 'awaiting' ? rowsAwaiting :
    rowsFollowUp;

  // ---- selection ----
  const selAllIds = useMemo(() => rowsAll.filter((l) => selAll.has(l.id)).map((l) => l.id), [rowsAll, selAll]);
  const selVerIds = useMemo(() => rowsVerify.filter((l) => selVer.has(l.id)).map((l) => l.id), [rowsVerify, selVer]);
  const toggleOne = (setFn) => (id) => setFn((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleOneAll = toggleOne(setSelAll);
  const toggleOneVer = toggleOne(setSelVer);

  // ---- actions ----
  const findListing = (id) => (all || []).find((l) => l.id === id);
  const doFeature = async (id) => { const rec = await toggleFeatured(id); if (rec) logAudit('Listing', `${rec.featured ? 'Featured' : 'Unfeatured'} "${rec.title}"`); toast(rec && rec.featured ? 'Marked as featured' : 'Removed from featured'); refresh(); };
  const doClearFlag = (l) => { if (!window.confirm(`Clear the flag on "${l.title}"?`)) return; clearFlag(l.id); setPipelineStage(l.id, 'live'); logAudit('Listing', `Cleared flag & published "${l.title}"`); toast('Flag cleared — listing published', 'success'); refresh(); };
  const doArchive = (l) => { setArchiveFor(l); setArchiveReason(''); setInternalNote(''); };
  const submitArchive = () => { archiveListing(archiveFor.id, archiveReason.trim() || undefined); submitNote('listing', archiveFor.id, internalNote, 'Archived'); logAudit('Listing', `Archived "${archiveFor.title}"${archiveReason.trim() ? ' — ' + archiveReason.trim() : ''}`); setArchiveFor(null); toast('Listing archived'); refresh(); };
  const doRestore = (l) => { if (!window.confirm(`Restore "${l.title}"?`)) return; restoreListing(l.id); logAudit('Listing', `Restored "${l.title}" from archive`); toast('Listing restored — moved to pending review', 'success'); refresh(); };
  const openFlag = (l) => { setFlagFor(l); setFlagReason(''); setInternalNote(''); };
  const submitFlag = () => { const r = flagReason.trim(); if (!r) { toast('Add a reason before flagging', 'error'); return; } flagListing(flagFor.id, r); submitNote('listing', flagFor.id, internalNote, 'Flagged'); logAudit('Listing', `Flagged "${flagFor.title}" — ${r}`); setFlagFor(null); toast('Listing flagged'); refresh(); };
  const openEdit = (l) => { setEdit({ id: l.id, title: l.title || '', price: l.price ?? '', area: l.area ?? '', bhk: l.bhk || '', type: l.type || '', locality: l.locality || '', deal: l.deal || 'buy', status: l.status || 'pending', _ref: l }); };
  const submitEdit = () => { const title = edit.title.trim(); const price = +edit.price; const area = edit.area === '' ? '' : +edit.area; const loc = edit.locality.trim(); if (!title) return toast('Title is required', 'error'); if (Number.isNaN(price) || price <= 0) return toast('Enter a valid price', 'error'); if (area !== '' && (Number.isNaN(area) || area < 0)) return toast('Area must be a positive number', 'error'); if (!loc) return toast('Locality is required', 'error'); updateListingFields(edit.id, { title, price, area: area || edit._ref.area, bhk: edit.bhk.trim(), type: edit.type.trim(), locality: loc, deal: edit.deal, status: edit.status }); logAudit('Listing', `Edited "${title}" (${edit.id})`); setEdit(null); toast('Listing updated', 'success'); refresh(); };
  const openReview = (l) => { setReview(l); };
  const handleReminder = async (l) => { await sendOwnerReminder(l.id); toast(`Reminder sent to ${l.owner} (+91 ${l.ownerMobile || ''})`, 'success'); refresh(); };
  const handleConfirmReminder = async (l) => { const tpl = freshnessState(l) === 'dormant' ? 'wa-dormant' : 'wa-stale'; await sendWhatsappTemplate(l.id, tpl); logAudit('Listing', `Sent availability-confirmation WhatsApp to ${l.owner || 'owner'} for "${l.title}"`); toast(`WhatsApp sent to ${l.owner} (+91 ${l.ownerMobile || ''}) to confirm availability`, 'success'); refresh(); };
  const advancePipeline = async (id, newStage) => { await setPipelineStage(id, newStage); logAudit('Pipeline', `Moved listing ${id} to "${PIPELINE_STAGES.find((s) => s.key === newStage)?.label}"`); toast('Pipeline stage updated', 'success'); refresh(); };

  // ---- bulk ----
  const bulkFeature = () => { if (!selAllIds.length) return; if (!window.confirm(`Toggle featured for ${selAllIds.length} listing(s)?`)) return; selAllIds.forEach((id) => toggleFeatured(id)); logAudit('Listings', `Toggled featured for ${selAllIds.length} listing(s)`); toast(`${selAllIds.length} listing(s) updated`); setSelAll(new Set()); refresh(); };
  const bulkArchive = () => { if (!selAllIds.length) return; if (!window.confirm(`Archive ${selAllIds.length} listing(s)?`)) return; selAllIds.forEach((id) => archiveListing(id, 'Bulk archive')); logAudit('Listings', `Bulk archived ${selAllIds.length} listing(s)`); toast(`${selAllIds.length} listing(s) archived`); setSelAll(new Set()); refresh(); };
  const bulkApprove = () => { if (!selVerIds.length) return; if (!window.confirm(`Approve ${selVerIds.length} listing(s)?`)) return; selVerIds.forEach((id) => { const l = findListing(id); if (!l) return; ensureReview(l); decideReview(id, 'approved'); setListingStatus(id, 'approved'); updateListingFields(id, { flagReason: '' }); }); logAudit('Listings', `Bulk approved ${selVerIds.length} listing(s)`); toast(`${selVerIds.length} listing(s) approved`, 'success'); setSelVer(new Set()); refresh(); };
  const submitBulkReject = () => { const reason = bulkReason.trim(); if (!reason) { toast('Add a reason before rejecting', 'error'); return; } selVerIds.forEach((id) => { const l = findListing(id); if (!l) return; ensureReview(l); decideReview(id, 'rejected', reason); setListingStatus(id, 'rejected'); }); logAudit('Listings', `Bulk rejected ${selVerIds.length} listing(s)`); toast(`${selVerIds.length} listing(s) rejected`, 'error'); setBulkRejectOpen(false); setBulkReason(''); setSelVer(new Set()); refresh(); };

  // ---- export ----
  const exportCurrentCsv = () => {
    if (activeTab === 'verify') exportCsv('punenest-verification-queue.csv', ['ID', 'Title', 'BHK', 'Type', 'Locality', 'Price', 'Owner', 'Mobile', 'Submitted'], rowsVerify.map((l) => [l.id, l.title, l.bhk, l.type, l.locality, l.price, l.owner, l.ownerMobile, l.createdAt]));
    else if (activeTab === 'flagged') exportCsv('punenest-flagged.csv', ['ID', 'Title', 'Locality', 'Price', 'Owner', 'Reason'], rowsFlagged.map((l) => [l.id, l.title, l.locality, l.price, l.owner, l.flagReason || 'Flagged']));
    else if (activeTab === 'featured') exportCsv('punenest-featured.csv', ['ID', 'Title', 'Locality', 'Price', 'Views', 'Enquiries'], rowsFeatured.map((l) => [l.id, l.title, l.locality, l.price, l.views, l.enquiries]));
    else exportCsv('punenest-listings.csv', ['ID', 'Title', 'BHK', 'Type', 'Locality', 'Price', 'Owner', 'Mobile', 'Views', 'Enquiries', 'Deal', 'Status', 'Featured'], rowsAll.map((l) => [l.id, l.title, l.bhk, l.type, l.locality, l.price, l.owner, l.ownerMobile, l.views, l.enquiries, l.deal, l.status, l.featured ? 'Yes' : 'No']));
  };

  if (!all) return <Loading />;

  const tabItems = [
    { key: 'all', label: 'All Listings' },
    { key: 'verify', label: 'Verification Queue' },
    { key: 'followup', label: 'Needs Follow-up' },
    { key: 'staff', label: 'Staff Posted' },
    { key: 'flagged', label: 'Flagged' },
    { key: 'featured', label: 'Featured' },
    { key: 'duplicates', label: dupCount ? `Duplicates (${dupCount})` : 'Duplicates' },
    { key: 'pipeline', label: 'Pipeline' },
  ];
  const visibleTabs = verifyOnly ? tabItems.filter((t) => t.key === 'verify') : tabItems;

  const actions = { onView: setView, onEdit: openEdit, onFeature: doFeature, onFlag: openFlag, onClearFlag: doClearFlag, onArchive: doArchive, onRestore: doRestore, onReview: openReview, onReminder: handleReminder };

  const renderListTab = (rows, query, setQuery, placeholder, countLabel, extraFilters, cardActions, selectable, selected, onSelect) => (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} className="pn-input sm:w-72" />
        {extraFilters}
        <DealPills value={fDeal} onChange={setFDeal} />
        <DateRangePills value={dateRange} onChange={setDateRange} />
        <span className="ml-auto text-sm text-gray-400">{rows.length} {countLabel}</span>
      </div>
      {rows.length === 0 ? (
        <p className="pn-card p-8 text-center text-gray-500">No listings match your filters</p>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, PAGE_LIMIT).map((l) => (
            <AdminPropertyCard key={l.id} listing={l} selectable={selectable} selected={selected?.(l.id)} onSelect={onSelect} showQualityScore={optionEnabled('properties.qualityScore')} actions={cardActions} />
          ))}
          <PaginationHint total={rows.length} />
        </div>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader title="Properties" subtitle={verifyOnly ? 'Review, verify and approve every listing before it goes live' : 'Manage, verify and curate every listing'} actions={optionEnabled('properties.csvExport') ? <button onClick={exportCurrentCsv} className="pn-btn pn-btn-ghost"><Download className="h-4 w-4" /> Export CSV</button> : null} />

      {/* KPI cards */}
      {!verifyOnly && (
      <div className="mb-5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <KpiCard label="Total" value={counts.total} icon={Building2} tint="indigo" onClick={() => jumpTo('all', '')} />
        <KpiCard label="Active" value={counts.approved} icon={CheckCircle2} tint="emerald" onClick={() => jumpTo('all', 'approved')} />
        <KpiCard label="Pending" value={counts.pending} icon={Clock} tint="amber" onClick={() => jumpTo('verify', '')} />
        <KpiCard label="Flagged" value={counts.flagged} icon={Flag} tint="rose" onClick={() => jumpTo('flagged', '')} />
        <KpiCard label="Duplicate" value={dupCount} icon={Copy} tint="rose" onClick={() => setTab('duplicates')} />
        <KpiCard label="Featured" value={counts.featured} icon={Star} tint="teal" onClick={() => jumpTo('featured', '')} />
      </div>
      )}

      {/* Tabs */}
      <HScroll role="tablist" wrapClassName="mb-4" fadeColor="var(--brand-card, #1a1730)" className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {visibleTabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={activeTab === t.key} onClick={() => setTab(t.key)} className={classNames('flex-1 shrink-0 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition', activeTab === t.key ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:text-white')}>
            {t.label}
          </button>
        ))}
      </HScroll>

      {/* Tab content */}
      {activeTab === 'all' && (
        <>
          {optionEnabled('properties.bulkOps') && selAllIds.length ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="font-semibold">{selAllIds.length} selected</span><div className="flex-1" />
              <button onClick={bulkFeature} className="pn-btn pn-btn-ghost pn-btn-sm"><Star className="h-4 w-4" /> Toggle featured</button>
              <button onClick={bulkArchive} className="pn-btn pn-btn-danger pn-btn-sm"><Archive className="h-4 w-4" /> Archive selected</button>
            </div>
          ) : null}
          {renderListTab(rowsAll, qAll, setQAll, 'Search title, owner, locality\u2026', `of ${(all || []).length} listings`,
            <><Select value={fStatus} onChange={setFStatus} options={STATUS_OPTS} className="sm:w-44" ariaLabel="Filter by status" />{optionEnabled('properties.qualityScore') && <QualityPills value={fQuality} onChange={setFQuality} />}</>,
            actions, optionEnabled('properties.bulkOps'), (id) => selAll.has(id), toggleOneAll)}
        </>
      )}

      {activeTab === 'verify' && (
        <>
          {optionEnabled('properties.bulkOps') && selVerIds.length ? (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="font-semibold">{selVerIds.length} selected</span><div className="flex-1" />
              <button onClick={bulkApprove} className="pn-btn pn-btn-success pn-btn-sm"><Check className="h-4 w-4" /> Approve selected</button>
              <button onClick={() => setBulkRejectOpen(true)} className="pn-btn pn-btn-danger pn-btn-sm"><X className="h-4 w-4" /> Reject selected</button>
            </div>
          ) : null}
          {renderListTab(rowsVerify, qVerify, setQVerify, 'Search title, owner, locality\u2026', 'pending', null,
            { onView: setView, onEdit: openEdit, onReview: openReview, onFlag: openFlag, onArchive: doArchive }, optionEnabled('properties.bulkOps'), (id) => selVer.has(id), toggleOneVer)}
        </>
      )}

      {activeTab === 'flagged' && renderListTab(rowsFlagged, qFlagged, setQFlagged, 'Search title, owner, locality\u2026', 'flagged', null, { onView: setView, onEdit: openEdit, onClearFlag: doClearFlag, onArchive: doArchive })}
      {activeTab === 'featured' && renderListTab(rowsFeatured, qFeatured, setQFeatured, 'Search title, locality\u2026', 'featured', null, { onView: setView, onEdit: openEdit, onFeature: doFeature, onFlag: openFlag, onArchive: doArchive })}
      {activeTab === 'staff' && renderListTab(rowsStaff, qStaff, setQStaff, 'Search title, owner, staff name\u2026', 'staff-posted', null, { onView: setView, onEdit: openEdit, onReview: openReview, onArchive: doArchive })}

      {activeTab === 'followup' && (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input value={qFollowUp} onChange={(e) => setQFollowUp(e.target.value)} placeholder={'Search title, owner, locality\u2026'} className="pn-input sm:w-72" />
            <Select value={followUpSub} onChange={setFollowUpSub} options={[{ value: 'all', label: 'All reasons' }, { value: 'stale', label: 'Stale pending' }, { value: 'awaiting', label: 'Awaiting owner' }, { value: 'unconfirmed', label: 'Unconfirmed (stale)' }]} className="sm:w-48" ariaLabel="Filter by reason" />
            <DealPills value={fDeal} onChange={setFDeal} />
            <DateRangePills value={dateRange} onChange={setDateRange} />
            <span className="ml-auto text-sm text-gray-400">{activeFollowUp.length} listings</span>
          </div>
          {followUpSub === 'unconfirmed' && (
            <p className="pn-card px-4 py-3 mb-3 text-xs text-gray-400 flex items-start gap-2">
              <Clock className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
              <span>Live listings whose owners haven't confirmed availability in over {30} days. Send a WhatsApp nudge so buyers keep seeing fresh, trustworthy listings.</span>
            </p>
          )}
          {activeFollowUp.length === 0 ? (
            <p className="pn-card p-8 text-center text-gray-500">All caught up — no listings need follow-up right now.</p>
          ) : (
            <div className="space-y-3">
              {activeFollowUp.slice(0, PAGE_LIMIT).map((l) => (
                <AdminPropertyCard key={l.id} listing={l} showQualityScore={optionEnabled('properties.qualityScore')} actions={followUpSub === 'unconfirmed'
                  ? { onView: setView, onEdit: openEdit, onReminder: handleConfirmReminder, reminderAlways: true, onFlag: openFlag, onArchive: doArchive }
                  : { onView: setView, onEdit: openEdit, onReview: openReview, onReminder: handleReminder, onFlag: openFlag, onArchive: doArchive }} />
              ))}
              <PaginationHint total={activeFollowUp.length} />
            </div>
          )}
        </div>
      )}

      {activeTab === 'pipeline' && <PipelineTab all={all} onAdvancePipeline={advancePipeline} />}

      {activeTab === 'duplicates' && <DuplicatesTab onRefresh={refresh} />}

      {/* Modals */}
      {review && <PropertyReviewModal review={review} setReview={setReview} onRefresh={refresh} />}
      <PropertyEditModal edit={edit} setEdit={setEdit} onSubmit={submitEdit} />
      <PropertyFlagModal flagFor={flagFor} setFlagFor={setFlagFor} flagReason={flagReason} setFlagReason={setFlagReason} internalNote={internalNote} setInternalNote={setInternalNote} onSubmit={submitFlag} />
      <PropertyArchiveModal archiveFor={archiveFor} setArchiveFor={setArchiveFor} archiveReason={archiveReason} setArchiveReason={setArchiveReason} internalNote={internalNote} setInternalNote={setInternalNote} onSubmit={submitArchive} />
      <PropertyViewModal view={view} setView={setView} />
      <PropertyBulkRejectModal open={bulkRejectOpen} onClose={() => setBulkRejectOpen(false)} count={selVerIds.length} bulkReason={bulkReason} setBulkReason={setBulkReason} onSubmit={submitBulkReject} />
    </div>
  );
}
