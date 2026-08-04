import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import Select from '../ui/Select.jsx';
import Tip from '../ui/Tip.jsx';
import { fmtINR, timeAgo, avatarFor } from '../../lib/format.js';
import { getDocsForProp, addDocument, deleteDocument, getDocRequests, respondDocRequest, countSharedDocs, notifyBuyerDocsGranted, formatSize, getChecklistProgress, DOC_CATEGORIES, docInfo } from '../../lib/data/documents.js';
import { generateRentReceipts, fyStart, thisMonth } from '../../lib/data/rentReceiptGen.js';
import { getRentAgreements, getRentLedger } from '../../lib/store.js';
import { loadTenancies } from '../../lib/data/tenancy.js';
import { openDocUrl } from '../../lib/openDoc.js';

/* Owner-side document packs (property-based). Uses the richer domain category model so the
   vault mirrors what an Indian owner/seller actually needs for a sale or bank submission.
   `cats` holds the English document-type ids that are stored on every upload, so they stay
   as-is; only the group heading and sub-line are keyed. */
const OWNER_GROUPS = [
  { id: 'title', titleKey: 'dash.grpTitle', subKey: 'dash.grpTitleSub', icon: 'scroll-text', tone: 'teal', cats: DOC_CATEGORIES['Title & Ownership'] },
  { id: 'society', titleKey: 'dash.grpSociety', subKey: 'dash.grpSocietySub', icon: 'building-2', tone: 'teal', cats: DOC_CATEGORIES['Society'] },
  { id: 'approvals', titleKey: 'dash.grpApprovals', subKey: 'dash.grpApprovalsSub', icon: 'file-badge', tone: 'teal', cats: DOC_CATEGORIES['Approvals & Plans'] },
  { id: 'purchase', titleKey: 'dash.grpPurchase', subKey: 'dash.grpPurchaseSub', icon: 'receipt-indian-rupee', tone: 'teal', cats: DOC_CATEGORIES['Purchase & Payments'] },
  { id: 'tax', titleKey: 'dash.grpTax', subKey: 'dash.grpTaxSub', icon: 'zap', tone: 'amber', cats: DOC_CATEGORIES['Tax & Utilities'] },
];

const KYC_GROUP = { id: 'kyc', titleKey: 'dash.grpKyc', subKey: 'dash.grpKycSub', icon: 'fingerprint', tone: 'amber', cats: ['Aadhaar Card', 'PAN Card', 'Passport Photo', 'Ownership Proof'] };

const OWNER_CATS = OWNER_GROUPS.flatMap((g) => g.cats);

/* Match an uploaded doc to a slot: exact category first, then the legacy loose match so any
   documents saved by the previous version of the tab still line up with their slot. */
const findDoc = (list, category) =>
  (list || []).find((d) => d.category === category) ||
  (list || []).find((d) => d.category?.toLowerCase().includes(category.toLowerCase().slice(0, 8)));

const countDone = (cats, docs) => cats.filter((c) => findDoc(docs, c)).length;

/* A rent agreement belongs to the property it was registered for. Match by the
   canonical `propId` first; fall back to a loose title match so legacy agreements
   (which only stored a property name) still land under the right flat. */
const agreementMatchesProp = (ra, propId, listing) => {
  if (ra.propId) return ra.propId === propId;
  const t = (listing?.title || '').toLowerCase();
  const raT = (ra.property || ra.title || '').toLowerCase();
  return !!t && !!raT && (raT.includes(t) || t.includes(raT));
};

function Ring({ done, total, size = 72, stroke = 7 }) {
  const pct = total ? done / total : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const complete = total > 0 && done === total;
  const col = complete ? '#34d399' : done > 0 ? '#2dd4bf' : 'rgba(255,255,255,0.18)';
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={col} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-white text-sm font-bold leading-none">{done}<span className="text-gray-500 text-[10px] font-semibold">/{total}</span></span>
      </div>
    </div>
  );
}

function InfoDot({ category }) {
  const { t } = useTranslation();
  const info = docInfo(category);
  if (!info) return null;
  return (
    <Tip title={info.title} body={info.body}>
      <button type="button" aria-label={t('dash.whatIsCat', { category })} className="absolute top-2 right-2 z-20 w-5 h-5 rounded-full bg-white/8 hover:bg-white/15 text-gray-400 hover:text-teal-300 flex items-center justify-center transition pointer-events-auto">
        <Icon name="info" className="w-3 h-3" />
      </button>
    </Tip>
  );
}

function DocTile({ category, doc, onUpload, onRemove, onView }) {
  const { t } = useTranslation();
  const hasInfo = !!docInfo(category);
  if (doc) {
    return (
      <div className="relative rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3 flex flex-col gap-2 min-h-[96px] transition hover:border-emerald-400/40">
        <InfoDot category={category} />
        <div className={'flex items-start gap-2 ' + (hasInfo ? 'pr-6' : '')}>
          <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0"><Icon name="file-text" className="w-4 h-4 text-emerald-400" /></div>
          <p className="text-white text-xs font-semibold leading-tight line-clamp-2 flex-1 min-w-0">{category}</p>
        </div>
        <p className="text-gray-500 text-[10px] truncate">{doc.name}{doc.size ? ' · ' + formatSize(doc.size) : ''}</p>
        <div className="flex items-center gap-1.5 mt-auto">
          <button onClick={() => onView(doc)} className="flex-1 text-[10px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-200 font-semibold inline-flex items-center justify-center gap-1"><Icon name="eye" className="w-3 h-3" /> {t('dash.view')}</button>
          <button onClick={() => onRemove(doc.id)} className="text-gray-500 hover:text-rose-400 p-1 rounded-md hover:bg-rose-500/10" aria-label={t('dash.removeCat', { category })}><Icon name="trash-2" className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    );
  }
  return (
    <div className="group relative rounded-xl border border-dashed border-white/15 bg-white/[0.02] min-h-[96px] transition hover:border-teal-400/50 hover:bg-teal-400/[0.04]">
      {/* Full-tile click layer for upload; the info button sits above it as a sibling (never nested). */}
      <button onClick={() => onUpload(category)} className="absolute inset-0 w-full h-full rounded-xl" aria-label={t('dash.uploadCat', { category })} />
      <InfoDot category={category} />
      <div className="relative pointer-events-none p-3 flex flex-col gap-2 h-full">
        <div className={'flex items-start gap-2 ' + (hasInfo ? 'pr-6' : '')}>
          <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0 group-hover:bg-teal-400/15 transition"><Icon name="file-up" className="w-4 h-4 text-gray-500 group-hover:text-teal-400 transition" /></div>
          <p className="text-gray-400 text-xs font-medium leading-tight line-clamp-2 flex-1 min-w-0 group-hover:text-gray-300">{category}</p>
        </div>
        <span className="mt-auto inline-flex items-center gap-1 text-[10px] font-semibold text-teal-400/80 group-hover:text-teal-300"><Icon name="upload" className="w-3 h-3" /> {t('dash.upload')}</span>
      </div>
    </div>
  );
}

function CategoryCard({ group, docs, open, onToggle, onUpload, onRemove, onView }) {
  const { t } = useTranslation();
  const total = group.cats.length;
  const done = countDone(group.cats, docs);
  const complete = total > 0 && done === total;
  const toneCls = group.tone === 'amber' ? 'bg-amber-500/15 text-amber-400' : 'bg-teal-500/15 text-teal-400';
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <button onClick={() => onToggle(group.id)} className="w-full flex items-center gap-3 p-4 sm:p-5 text-left hover:bg-white/[0.02] transition" aria-expanded={open}>
        <div className={'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ' + toneCls}><Icon name={group.icon} className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-white text-sm font-semibold truncate">{t(group.titleKey)}</p>
            <span className={'text-[10px] px-2 py-0.5 rounded-full font-semibold ' + (complete ? 'bg-emerald-500/15 text-emerald-300' : done ? 'bg-amber-500/15 text-amber-300' : 'bg-white/[0.08] text-gray-400')}>{done}/{total}</span>
          </div>
          {group.subKey && <p className="text-gray-500 text-xs mt-0.5 truncate">{t(group.subKey)}</p>}
          <div className="mt-2 h-1 rounded-full bg-white/[0.08] overflow-hidden max-w-[240px]">
            <div className={'h-full rounded-full transition-all duration-500 ' + (complete ? 'bg-emerald-400' : 'bg-teal-400')} style={{ width: (total ? (done / total) * 100 : 0) + '%' }} />
          </div>
        </div>
        <Icon name="chevron-down" className={'w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      <div className={'px-4 sm:px-5 border-t border-white/5 overflow-hidden transition-all duration-200 ' + (open ? 'max-h-[3000px] pb-5 pt-4 opacity-100' : 'max-h-0 pb-0 pt-0 opacity-0')}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {group.cats.map((cat) => <DocTile key={cat} category={cat} doc={findDoc(docs, cat)} onUpload={onUpload} onRemove={onRemove} onView={onView} />)}
        </div>
      </div>
    </div>
  );
}

function PanelCard({ id, icon, tone, title, sub, badge, open, onToggle, children }) {
  const toneCls = tone === 'amber' ? 'bg-amber-500/15 text-amber-400' : tone === 'emerald' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-teal-500/15 text-teal-400';
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <button onClick={() => onToggle(id)} className="w-full flex items-center gap-3 p-4 sm:p-5 text-left hover:bg-white/[0.02] transition" aria-expanded={open}>
        <div className={'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ' + toneCls}><Icon name={icon} className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-white text-sm font-semibold truncate">{title}</p>
            {badge}
          </div>
          {sub && <p className="text-gray-500 text-xs mt-0.5 truncate">{sub}</p>}
        </div>
        <Icon name="chevron-down" className={'w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      <div className={'px-4 sm:px-5 border-t border-white/5 overflow-hidden transition-all duration-200 ' + (open ? 'max-h-[3000px] pb-5 pt-4 opacity-100' : 'max-h-0 pb-0 pt-0 opacity-0')}>{children}</div>
    </div>
  );
}

const pill = (cls, children) => <span className={'text-[10px] px-2 py-0.5 rounded-full font-semibold ' + cls}>{children}</span>;

/* Shared renderer for a list of rent agreements, used by both the tenant "Personal"
   vault and the owner per-property vault so the two can never drift apart. */
function AgreementList({ ras, emptyText }) {
  const { t } = useTranslation();
  if (!ras.length) {
    return (
      <div className="text-center py-6">
        <Icon name="file-signature" className="w-8 h-8 text-gray-600 mx-auto" />
        <p className="text-gray-500 text-sm mt-2">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {ras.map((ra, i) => (
        <div key={ra.id || i} className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
          <div className="w-9 h-9 rounded-lg bg-teal-400/15 flex items-center justify-center flex-shrink-0"><Icon name="file-text" className="w-4 h-4 text-teal-400" /></div>
          <div className="flex-1 min-w-0"><p className="text-white text-sm font-medium truncate">{ra.property || ra.title || t('dash.agreementFallback')}</p><p className="text-gray-500 text-[11px] truncate">{ra.tenant || t('dash.tenantFallback')} · {ra.date || 'N/A'}</p></div>
          <button className="text-[10px] px-2.5 py-1 rounded-lg bg-white/5 text-gray-300 font-semibold hover:bg-white/10 flex-shrink-0">{t('dash.download')}</button>
        </div>
      ))}
    </div>
  );
}

export default function DocumentsTab({ user, listings, toast, isOwner = false }) {
  const { t } = useTranslation();
  const propList = listings || [];
  // A tenant's rented home(s) are the single source of truth for their tenancy vault.
  // A non-owner who has a rent agreement but no finalised tenancy record still counts,
  // so their agreement always has a home.
  const tenancies = loadTenancies(user);
  const isTenant = tenancies.length > 0 || (!isOwner && getRentAgreements().length > 0);
  const [context, setContext] = useState(isOwner ? 'owner' : isTenant ? 'tenancy' : 'personal');
  const [docProp, setDocProp] = useState(propList[0]?.id || 'portfolio');
  const [tenProp, setTenProp] = useState(tenancies[0]?.propId || '');
  // Listings load async in Dashboard, so on first render propList is empty and docProp
  // falls back to 'portfolio'. Once the owner's real properties arrive, point the selector
  // at the first one instead of leaving it stuck on the empty-state bucket.
  useEffect(() => {
    if (propList.length && !propList.some((l) => l.id === docProp)) setDocProp(propList[0].id);
  }, [listings]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tenancies.length && !tenancies.some((t) => t.propId === tenProp)) setTenProp(tenancies[0].propId);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tick, setTick] = useState(0); // eslint-disable-line no-unused-vars -- re-render trigger after localStorage writes
  const [openSections, setOpenSections] = useState({ title: true, kyc: true });
  const toggle = (key) => setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  const [hraForm, setHraForm] = useState({ landlordName: '', landlordPan: '', landlordAddr: '', tenantName: user?.name || '', tenantPan: '', fromMonth: fyStart(), toMonth: thisMonth(), rentAmt: '', propertyAddr: '' });

  const activeProp = context === 'owner' ? docProp : 'personal';
  const ownerDocs = getDocsForProp(user?.mobile, docProp);
  const personalDocs = getDocsForProp(user?.mobile, 'personal');
  const docReqs = getDocRequests(user?.mobile);
  const checklist = getChecklistProgress(user?.mobile, docProp);
  // Rent agreement is tenancy/property-specific, so the owner vault shows only the
  // agreement(s) for the currently selected property (matched by propId).
  const selectedListing = propList.find((l) => l.id === docProp);
  const propAgreements = getRentAgreements().filter((ra) => agreementMatchesProp(ra, docProp, selectedListing));
  // Tenant side: the rental they signed for. Scope the agreement to the selected
  // tenancy when we know the flat; otherwise show all of the tenant's own agreements.
  const selectedTenancy = tenancies.find((t) => t.propId === tenProp) || tenancies[0];
  const tenancyAgreements = selectedTenancy
    ? getRentAgreements().filter((ra) => agreementMatchesProp(ra, selectedTenancy.propId, selectedTenancy))
    : getRentAgreements();

  const propOptions = propList.length
    ? propList.map((l) => ({ value: l.id, label: l.title + (l.deal === 'rent' ? ` · ${t('dash.dealRent')}` : ` · ${t('dash.dealSale')}`) }))
    : [{ value: 'portfolio', label: t('dash.myPortfolio') }];

  const uploadForCategory = (category) => {
    const targetProp = activeProp; // capture now — context/property may change while the file reads
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
    inp.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { addDocument(user?.mobile, targetProp, { category, name: file.name, size: file.size, mime: file.type || '', dataUrl: reader.result }); setTick((n) => n + 1); toast(t('dash.uploadedToast', { file: file.name, category }), 'success'); };
      reader.readAsDataURL(file);
    };
    inp.click();
  };
  const removeDoc = (id) => { deleteDocument(user?.mobile, activeProp, id); setTick((n) => n + 1); toast(t('dash.docRemovedToast')); };
  const handleDocReq = (reqId, grant) => {
    respondDocRequest(user?.mobile, reqId, grant ? 'granted' : 'declined');
    setTick((n) => n + 1);
    if (!grant) { toast(t('dash.reqDeclinedToast'), 'info'); return; }
    const shared = countSharedDocs(user?.mobile, [reqId]);
    if (shared > 0) {
      notifyBuyerDocsGranted(user?.mobile, [reqId]);
      toast(t('dash.accessGrantedToast'), 'success');
    } else {
      toast(t('dash.approvedNoDocToast'), 'info');
    }
  };
  const viewDoc = (doc) => { if (!openDocUrl(doc.dataUrl)) toast(t('dash.noPreviewToast')); };
  const genHraReceipts = () => {
    if (!hraForm.landlordName || !hraForm.tenantName || !hraForm.rentAmt || !hraForm.propertyAddr) { toast(t('dash.fillRequiredToast'), 'error'); return; }
    try { generateRentReceipts({ landlordName: hraForm.landlordName, landlordPan: hraForm.landlordPan, landlordAddress: hraForm.landlordAddr, tenantName: hraForm.tenantName, tenantPan: hraForm.tenantPan, fromMonth: hraForm.fromMonth, toMonth: hraForm.toMonth, rentAmount: parseFloat(hraForm.rentAmt), propertyAddress: hraForm.propertyAddr }); toast(t('dash.receiptsDownloaded'), 'success'); } catch { toast(t('dash.receiptsFailed'), 'error'); }
  };

  const headerDone = context === 'owner' ? countDone(OWNER_CATS, ownerDocs)
    : context === 'tenancy' ? (tenancyAgreements.length ? 1 : 0)
    : countDone(KYC_GROUP.cats, personalDocs);
  const headerTotal = context === 'owner' ? OWNER_CATS.length
    : context === 'tenancy' ? 1
    : KYC_GROUP.cats.length;
  const pendingReqs = docReqs.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-5">
      {/* ── Vault header: completeness ring + trust + context switch ── */}
      <div className="glass-card rounded-2xl p-5 sm:p-6 relative overflow-hidden">
        <div className="absolute -top-16 -right-10 w-56 h-56 rounded-full bg-teal-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
          <Ring done={headerDone} total={headerTotal} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Icon name="folder-lock" className="w-5 h-5 text-teal-400" />
              <h2 className="text-white text-lg font-bold">{t('dash.vaultTitle')}</h2>
            </div>
            <p className="text-gray-400 text-sm mt-1 flex items-center gap-1.5">
              <Icon name="lock" className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              {t('dash.vaultSub')}
            </p>
            {(isOwner || isTenant) && (
              <div className="inline-flex mt-3 p-1 rounded-full bg-white/5 border border-white/10">
                {[
                  isOwner && ['owner', 'home', 'dash.ctxOwner'],
                  isTenant && ['tenancy', 'key', 'dash.ctxTenancy'],
                  ['personal', 'fingerprint', 'dash.ctxPersonal'],
                ].filter(Boolean).map(([c, ic, labelKey]) => (
                  <button key={c} onClick={() => setContext(c)} className={'px-4 h-9 rounded-full text-xs font-semibold transition inline-flex items-center gap-1.5 ' + (context === c ? 'bg-brand-teal text-ink' : 'text-gray-400 hover:text-white')}>
                    <Icon name={ic} className="w-3.5 h-3.5" /> {t(labelKey)}
                  </button>
                ))}
              </div>
            )}
          </div>
          {context === 'owner' && (
            <div className="sm:w-64 flex-shrink-0">
              <label className="text-gray-500 text-[11px] font-medium mb-1.5 block">{t('dash.managingFor')}</label>
              <Select value={docProp} onChange={setDocProp} options={propOptions} placeholder={t('dash.selectProperty')} className="w-full" />
            </div>
          )}
          {context === 'tenancy' && tenancies.length > 1 && (
            <div className="sm:w-64 flex-shrink-0">
              <label className="text-gray-500 text-[11px] font-medium mb-1.5 block">{t('dash.rentedHome')}</label>
              <Select value={tenProp} onChange={setTenProp} options={tenancies.map((x) => ({ value: x.propId, label: x.title }))} placeholder={t('dash.selectRental')} className="w-full" />
            </div>
          )}
        </div>
      </div>

      {/* ── Owner context: property-based document packs ── */}
      {context === 'owner' && (
        <>
          {OWNER_GROUPS.map((g) => (
            <CategoryCard key={g.id} group={g} docs={ownerDocs} open={!!openSections[g.id]} onToggle={toggle} onUpload={uploadForCategory} onRemove={removeDoc} onView={viewDoc} />
          ))}

          <PanelCard id="ownerAgreements" icon="file-signature" tone="teal" title={t('dash.rentAgreement')}
            sub={selectedListing ? t('dash.agreementForProp', { title: selectedListing.title }) : t('dash.agreementForThis')}
            badge={propAgreements.length ? pill('bg-teal-500/15 text-teal-300', String(propAgreements.length)) : null}
            open={!!openSections.ownerAgreements} onToggle={toggle}>
            <AgreementList ras={propAgreements} emptyText={t('dash.noAgreementProp')} />
          </PanelCard>

          <PanelCard id="checklist" icon="clipboard-list" tone="amber" title={t('dash.loanChecklist')} sub={t('dash.loanChecklistSub')}
            badge={pill(checklist.items.every((i) => i.done) ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300', `${checklist.items.filter((i) => i.done).length}/${checklist.items.length}`)}
            open={!!openSections.checklist} onToggle={toggle}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {checklist.items.map((it) => (
                <div key={it.name} className={'flex items-center gap-3 p-2.5 rounded-lg border ' + (it.done ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/[0.08] bg-white/[0.02]')}>
                  <Icon name={it.done ? 'check-circle' : 'circle'} className={'w-4 h-4 flex-shrink-0 ' + (it.done ? 'text-emerald-400' : 'text-gray-500')} />
                  <span className={'text-xs ' + (it.done ? 'text-emerald-300' : 'text-gray-400')}>{it.name}</span>
                </div>
              ))}
            </div>
          </PanelCard>

          {docReqs.length > 0 && (
            <PanelCard id="requests" icon="user-check" tone="teal" title={t('dash.docRequests')} sub={t('dash.docRequestsSub')}
              badge={pendingReqs > 0 ? pill('bg-amber-500/15 text-amber-300', t('dash.pendingCount', { count: pendingReqs })) : null}
              open={openSections.requests !== false} onToggle={toggle}>
              <div className="space-y-3">
                {docReqs.map((r) => (
                  <div key={r.id} className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">{avatarFor(r.buyerName)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{r.buyerName}</p>
                      <p className="text-gray-500 text-xs truncate">{t('dash.requestedLine', { docType: r.docType })} · {timeAgo(r.requestedAt)}</p>
                    </div>
                    {r.status === 'pending' ? (
                      <div className="flex gap-2 flex-shrink-0">
                        <button onClick={() => handleDocReq(r.id, true)} className="px-3 py-1.5 rounded-lg bg-teal-500/15 text-teal-300 text-xs font-semibold hover:bg-teal-500/25 flex items-center gap-1"><Icon name="check" className="w-3.5 h-3.5" /> {t('dash.grant')}</button>
                        <button onClick={() => handleDocReq(r.id, false)} className="px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 text-xs font-semibold hover:bg-white/10 flex items-center gap-1"><Icon name="x" className="w-3.5 h-3.5" /> {t('dash.decline')}</button>
                      </div>
                    ) : r.status === 'granted' ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-300 font-medium flex-shrink-0"><Icon name="badge-check" className="w-3.5 h-3.5" /> {t('dash.granted')}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-400 font-medium flex-shrink-0"><Icon name="x-circle" className="w-3.5 h-3.5" /> {t('dash.declined')}</span>
                    )}
                  </div>
                ))}
              </div>
            </PanelCard>
          )}

          <PanelCard id="payments" icon="indian-rupee" tone="emerald" title={t('dash.rentOnline')} sub={t('dash.rentOnlineSub')} open={!!openSections.payments} onToggle={toggle}>
            {(() => {
              const ledger = getRentLedger(user?.mobile);
              return ledger.length ? (
                <div className="space-y-2">
                  {ledger.slice(0, 5).map((entry, i) => (
                    <div key={entry.id || i} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                      <div className="w-9 h-9 rounded-lg bg-emerald-400/15 flex items-center justify-center flex-shrink-0"><Icon name="check-circle" className="w-4 h-4 text-emerald-400" /></div>
                      <div className="flex-1 min-w-0"><p className="text-white text-sm font-medium">{fmtINR(entry.amount || 0)}</p><p className="text-gray-500 text-[11px] truncate">{t('dash.fromTenant', { name: entry.tenantName || t('dash.tenantFallback') })} · {entry.at ? timeAgo(entry.at) : 'N/A'}</p></div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold flex-shrink-0">{entry.settlement || t('dash.settled')}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-gray-500 text-sm">{t('dash.noOnlineRent')}</p>;
            })()}
          </PanelCard>
        </>
      )}

      {/* ── Tenancy context: the flat the user rents + its registered agreement ── */}
      {context === 'tenancy' && (
        <>
          {selectedTenancy && (
            <div className="glass-card rounded-2xl p-4 sm:p-5 flex items-center gap-4">
              <img src={selectedTenancy.image} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-white text-sm font-semibold truncate">{selectedTenancy.title}</p>
                <p className="text-gray-500 text-xs truncate">{selectedTenancy.address}</p>
                <p className="text-gray-400 text-xs mt-0.5">{t('dash.landlordLine', { name: selectedTenancy.ownerName })}{selectedTenancy.rent ? ` · ${t('dash.perMonth', { amount: fmtINR(selectedTenancy.rent) })}` : ''}</p>
              </div>
            </div>
          )}

          <PanelCard id="tenancyAgreement" icon="file-signature" tone="teal" title={t('dash.rentAgreement')}
            sub={selectedTenancy ? t('dash.agreementForProp', { title: selectedTenancy.title }) : t('dash.agreementForRental')}
            badge={tenancyAgreements.length ? pill('bg-teal-500/15 text-teal-300', String(tenancyAgreements.length)) : null}
            open={openSections.tenancyAgreement !== false} onToggle={toggle}>
            <AgreementList ras={tenancyAgreements} emptyText={t('dash.noAgreementRental')} />
          </PanelCard>
        </>
      )}

      {/* ── Personal context: identity + tenant/buyer tools ── */}
      {context === 'personal' && (
        <>
          <CategoryCard group={KYC_GROUP} docs={personalDocs} open={!!openSections.kyc} onToggle={toggle} onUpload={uploadForCategory} onRemove={removeDoc} onView={viewDoc} />

          <PanelCard id="hra" icon="receipt" tone="teal" title={t('dash.hraTitle')} sub={t('dash.hraSub')} open={!!openSections.hra} onToggle={toggle}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('dash.landlordName')} <span className="text-rose-400">*</span></span><input value={hraForm.landlordName} onChange={(e) => setHraForm({ ...hraForm, landlordName: e.target.value })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" placeholder={t('dash.landlordNamePh')} /></label>
              <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('dash.landlordPan')}</span><input value={hraForm.landlordPan} onChange={(e) => setHraForm({ ...hraForm, landlordPan: e.target.value.toUpperCase() })} maxLength={10} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm uppercase" placeholder="ABCDE1234F" /></label>
              <label className="text-sm col-span-full"><span className="mb-1.5 block text-gray-400">{t('dash.landlordAddr')}</span><input value={hraForm.landlordAddr} onChange={(e) => setHraForm({ ...hraForm, landlordAddr: e.target.value })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" placeholder={t('dash.landlordAddrPh')} /></label>
              <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('dash.tenantNameLbl')} <span className="text-rose-400">*</span></span><input value={hraForm.tenantName} onChange={(e) => setHraForm({ ...hraForm, tenantName: e.target.value })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" /></label>
              <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('dash.tenantPan')}</span><input value={hraForm.tenantPan} onChange={(e) => setHraForm({ ...hraForm, tenantPan: e.target.value.toUpperCase() })} maxLength={10} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm uppercase" placeholder="ABCDE1234F" /></label>
              <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('dash.fromMonth')}</span><input type="month" value={hraForm.fromMonth} onChange={(e) => setHraForm({ ...hraForm, fromMonth: e.target.value })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" /></label>
              <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('dash.toMonth')}</span><input type="month" value={hraForm.toMonth} onChange={(e) => setHraForm({ ...hraForm, toMonth: e.target.value })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" /></label>
              <label className="text-sm"><span className="mb-1.5 block text-gray-400">{t('dash.monthlyRentLbl')} <span className="text-rose-400">*</span></span><input type="number" value={hraForm.rentAmt} onChange={(e) => setHraForm({ ...hraForm, rentAmt: e.target.value })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" placeholder="₹" /></label>
              <label className="text-sm col-span-full"><span className="mb-1.5 block text-gray-400">{t('dash.propertyAddr')} <span className="text-rose-400">*</span></span><input value={hraForm.propertyAddr} onChange={(e) => setHraForm({ ...hraForm, propertyAddr: e.target.value })} className="field w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm" placeholder={t('dash.propertyAddrPh')} /></label>
            </div>
            <button onClick={genHraReceipts} className="pn-control pn-control--action px-5 gap-2"><Icon name="download" className="w-4 h-4" /> {t('dash.generateReceipts')}</button>
          </PanelCard>
        </>
      )}
    </div>
  );
}
