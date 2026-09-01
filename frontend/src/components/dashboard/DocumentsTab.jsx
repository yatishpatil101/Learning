import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import PropertyImage from '../ui/PropertyImage.jsx';
import Select from '../ui/Select.jsx';
import Tip from '../ui/Tip.jsx';
import useAsyncList from '../../hooks/useAsyncList.js';
import LoadError from '../LoadError.jsx';
import { fmtINR, timeAgo, avatarFor } from '../../lib/format.js';
import { countSharedDocs, formatSize, checklistFromDocs, DOC_CATEGORIES, docInfo } from '../../lib/data/documents.js';
import { listDocuments, uploadDocument, deleteDocument, listDocRequests, respondDocRequest } from '../../services/documentService.js';
import { isHttpDomain } from '../../services/config.js';
import { generateRentReceipts, fyStart, thisMonth } from '../../lib/data/rentReceiptGen.js';
import { myTenancies, myRentAgreements, rentLedger } from '../../services/rentService.js';
import { toRentalCards } from '../../lib/data/tenancy.js';
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

function Ring({ done, total, size = 72, stroke = 7, loading = false }) {
  const pct = total ? done / total : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const complete = total > 0 && done === total;
  const col = complete ? '#34d399' : done > 0 ? '#2dd4bf' : 'rgba(255,255,255,0.18)';
  // While the vault is still loading its first read, show a muted, indeterminate ring rather than a
  // confident 0/N — the count is not known yet, and painting 0 then snapping is the reflow D125-3
  // called out (it is what destabilised doc-info.spec).
  if (loading) {
    return (
      <div className="relative flex-shrink-0 animate-pulse" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
          <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * 0.75} />
        </svg>
      </div>
    );
  }
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

/* Placeholder tiles shown while a vault is loading its first read, so a full vault never paints as
   an empty one and then snaps (D125-3). */
function VaultSkeleton() {
  return (
    <div className="glass-card rounded-2xl p-4 sm:p-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] min-h-[96px] animate-pulse" />
        ))}
      </div>
    </div>
  );
}

/* A failed load degrades to a retry affordance instead of vanishing — the honest counterpart to
   the old `.catch(() => [])` that removed the panel entirely (D125-1).

   The card itself now lives in `components/LoadError.jsx`, because the vault was only the first
   surface that needed it and copying it to the next eleven is how the wording drifts apart (D166).
   `VaultError` survives as the local binding so the three call sites below read unchanged. */
const VaultError = LoadError;

export default function DocumentsTab({ user, listings, toast, isOwner = false }) {
  const { t } = useTranslation();
  // The dashboard's shared `listings` collection also contains flatmate posts, groups and rooms.
  // They deliberately imitate property-card fields for the My Properties panel, but have no
  // catalogue-property UUID and therefore no `/me/documents/{propertyId}` vault. Showing one in
  // this picker made its first (and often only) selection a guaranteed 404. The HTTP mapper adds
  // `uuid` exclusively to real property rows; mock mode retains its legacy card-shaped rows.
  const propList = isHttpDomain('document')
    ? (listings || []).filter((listing) => !!listing.uuid)
    : (listings || []);
  /* A tenant's rented home(s) and the agreements they signed. Both are caller-scoped server reads,
     and the agreement list answers for either side of the lease — which is what this tab needs, as
     it renders an owner pack and a tenancy pack from the same list, narrowed by property. A
     non-owner who has an agreement but no finalised tenancy still counts as a tenant, so their
     paperwork always has a home. */
  const [rental, setRental] = useState({ tenancies: [], agreements: [], tenantNames: {}, loaded: false });
  useEffect(() => {
    let alive = true;
    Promise.all([
      myTenancies().catch(() => []),
      myRentAgreements().catch(() => []),
    ]).then(async ([rows, agreementRows]) => {
      if (!alive) return;
      const tenancies = await toRentalCards(rows);
      if (!alive) return;
      setRental({
        tenancies,
        agreements: agreementRows || [],
        /* Who paid, by tenancy. A rent-ledger row names its tenancy and not its payer, which is
           right — the payer is a fact about the lease, and repeating it on every payment would let
           a renamed user disagree with their own tenancy, the same reason `TenancyDto` refuses to
           carry the listing's title. `toRentalCard` is written from the tenant's side and keeps
           only the landlord, so the counterparty is taken from the raw row before it is discarded
           rather than asking the server for a per-caller field. */
        tenantNames: Object.fromEntries((rows || []).filter((r) => r?.id && r?.tenantName).map((r) => [r.id, r.tenantName])),
        loaded: true,
      });
    });
    return () => { alive = false; };
  }, [user]);

  const tenancies = rental.tenancies;
  const agreements = rental.agreements;
  const isTenant = tenancies.length > 0 || (!isOwner && agreements.length > 0);

  /* The owner's rent receipts. This read used to be `getRentLedger(user?.mobile)` — synchronous,
     keyed on a mobile the caller supplied, and therefore both readable for any owner you could name
     and empty on a live build, where nothing writes that key. So the panel quietly rendered
     "no online rent" to every owner who had actually been paid. `GET /me/rent-ledger` is scoped by
     token, which is the same reason the mobile parameter is gone rather than repointed. */
  const [ledger, setLedger] = useState([]);
  useEffect(() => {
    if (!isOwner) return undefined;
    let alive = true;
    rentLedger(0, 5)
      .then((page) => { if (alive) setLedger(page?.items || []); })
      .catch(() => { if (alive) setLedger([]); });
    return () => { alive = false; };
  }, [isOwner, user]);
  const [context, setContext] = useState(isOwner ? 'owner' : 'personal');
  /* `isOwner` is derived in `Dashboard` from a listings fetch, so it is false on the first render
     of every owner's session and true a moment later. A `useState` initialiser reads that first
     value once and keeps it, which put every owner on the Personal tab and left their property
     paperwork behind a toggle they had to find — the vault opened on the wrong half of itself.
     Only the initial default is corrected: an owner who has since clicked Personal is left there. */
  const contextChosen = useRef(false);
  useEffect(() => {
    if (isOwner && !contextChosen.current) setContext((c) => (c === 'personal' ? 'owner' : c));
  }, [isOwner]);
  // The tenancy context only exists once the server has confirmed a lease, so the tab opens on the
  // safe default and moves there when the answer arrives. Choosing it up front would put a
  // non-tenant on a tab that then vanished under them.
  useEffect(() => {
    if (rental.loaded && !isOwner && isTenant) setContext((c) => (c === 'personal' ? 'tenancy' : c));
  }, [rental.loaded, isOwner, isTenant]);
  const [docProp, setDocProp] = useState(propList[0]?.id || 'portfolio');
  const [tenProp, setTenProp] = useState('');
  useEffect(() => {
    if (!tenProp && tenancies[0]?.propId) setTenProp(tenancies[0].propId);
  }, [tenancies, tenProp]);
  // Listings load async in Dashboard, so on first render propList is empty and docProp
  // falls back to 'portfolio'. Once the owner's real properties arrive, point the selector
  // at the first one instead of leaving it stuck on the empty-state bucket — and when the last
  // listing goes away, fall back rather than holding a dead id the selector cannot show and the
  // server would 404 on.
  useEffect(() => {
    if (!propList.some((l) => l.id === docProp)) setDocProp(propList[0]?.id || 'portfolio');
  }, [listings]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tenancies.length && !tenancies.some((t) => t.propId === tenProp)) setTenProp(tenancies[0].propId);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const [openSections, setOpenSections] = useState({ title: true, kyc: true });
  const toggle = (key) => setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  const [hraForm, setHraForm] = useState({ landlordName: '', landlordPan: '', landlordAddr: '', tenantName: user?.name || '', tenantPan: '', fromMonth: fyStart(), toMonth: thisMonth(), rentAmt: '', propertyAddr: '' });

  // A listing's `id` is the route token (`slug || uuid`), but every document endpoint is
  // UUID-addressed. Passing the display/routing token here made an owner whose listing had a slug
  // receive a 404 and see an error card even though the vault existed. Keep `docProp` as the picker
  // value so the UI and deep links remain stable; translate only at the API boundary.
  const selectedListing = propList.find((l) => l.id === docProp);
  const docPropertyId = selectedListing?.uuid || docProp;
  const activeProp = context === 'owner' ? docPropertyId : 'personal';
  // Vault reads go through `documentService` (mock or live, per-domain). They are async, so the
  // rows the render body used to read synchronously become state, reloaded whenever the identity,
  // the selected property, or a mutation changes. Each list carries its own loading/error status so
  // a live failure surfaces as a retry affordance rather than a confident empty vault (D125-1/3).
  const mobile = user?.mobile;
  // 'portfolio' is the empty-state bucket shown before any listing exists. It is not a real listing
  // id, so it has no *server* vault — skip the fetch in http mode, where the GET would 404. The mock
  // store keys it like any other bucket, so mock mode must still read it back: an owner who owns
  // inventory but no listing uploads into `portfolio`, and skipping the read there would hide the
  // file they just uploaded behind a success toast.
  const ownerVaultEnabled = !!mobile && !!docPropertyId && !(docPropertyId === 'portfolio' && isHttpDomain('document'));
  const [ownerDocs, ownerStatus, setOwnerDocs, reloadOwner, ownerError] = useAsyncList(
    () => listDocuments(mobile, docPropertyId), [mobile, docPropertyId], ownerVaultEnabled,
  );
  const [personalDocs, personalStatus, setPersonalDocs, reloadPersonal, personalError] = useAsyncList(
    () => listDocuments(mobile, 'personal'), [mobile], !!mobile,
  );
  const [docReqs, reqStatus, setDocReqs, reloadReqs, reqError] = useAsyncList(
    () => listDocRequests(mobile), [mobile], !!mobile,
  );
  // A mutation resolves to the value the provider returns; applying it needs to know which vault is
  // on screen *now*, because the OS file dialog can stay open while the property picker moves. The
  // ref is read after the await so a stale closure cannot prepend a file to the wrong flat (D125-4).
  const activePropRef = useRef(activeProp);
  activePropRef.current = activeProp;
  const setDocsFor = (prop) => (prop === 'personal' ? setPersonalDocs : setOwnerDocs);
  const checklist = checklistFromDocs(ownerDocs);
  // Rent agreement is tenancy/property-specific, so the owner vault shows only the
  // agreement(s) for the currently selected property (matched by propId).
  const propAgreements = agreements.filter((ra) => agreementMatchesProp(ra, docPropertyId, selectedListing));
  // Tenant side: the rental they signed for. Scope the agreement to the selected
  // tenancy when we know the flat; otherwise show all of the tenant's own agreements.
  const selectedTenancy = tenancies.find((t) => t.propId === tenProp) || tenancies[0];
  const tenancyAgreements = selectedTenancy
    ? agreements.filter((ra) => agreementMatchesProp(ra, selectedTenancy.propId, selectedTenancy))
    : agreements;

  const propOptions = propList.length
    ? propList.map((l) => ({ value: l.id, label: l.title + (l.deal === 'rent' ? ` · ${t('dash.dealRent')}` : ` · ${t('dash.dealSale')}`) }))
    : [{ value: 'portfolio', label: t('dash.myPortfolio') }];

  const uploadForCategory = (category) => {
    const targetProp = activeProp; // capture now — context/property may change while the picker is open
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
    inp.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        // The seam speaks in `File`s; the provider (mock or live) owns the byte handling and returns
        // the created document. Apply it to the list it belongs to — but only if that vault is still
        // the one on screen, so a file uploaded to one flat never appears under another (D125-4).
        const created = await uploadDocument(mobile, targetProp, { category, file });
        if (created && activePropRef.current === targetProp) {
          setDocsFor(targetProp)((prev) => [created, ...prev]);
        }
        toast(t('dash.uploadedToast', { file: file.name, category }), 'success');
      } catch {
        toast(t('dash.uploadFailedToast'), 'error');
      }
    };
    inp.click();
  };
  const removeDoc = async (id) => {
    const targetProp = activeProp;
    try {
      // Both providers resolve delete to the property's remaining files — adopt that list directly
      // rather than refetching, and only when its vault is still on screen.
      const remaining = await deleteDocument(mobile, targetProp, id);
      if (activePropRef.current === targetProp) setDocsFor(targetProp)(remaining || []);
      toast(t('dash.docRemovedToast'));
    } catch { toast(t('dash.docRemoveFailedToast'), 'error'); }
  };
  const handleDocReq = async (reqId, grant) => {
    let updated;
    try {
      updated = await respondDocRequest(mobile, reqId, grant ? 'granted' : 'declined');
    } catch {
      toast(t('dash.reqFailedToast'), 'error');
      return;
    }
    // Patch just the answered row from the provider's return value — a grant no longer costs a
    // refetch of all three lists (D125-4).
    const nextStatus = grant ? 'granted' : 'declined';
    setDocReqs((prev) => prev.map((r) => (r.id === reqId ? (updated || { ...r, status: nextStatus }) : r)));
    if (!grant) { toast(t('dash.reqDeclinedToast'), 'info'); return; }
    // HTTP returns the count computed from the private vault after its re-read; the mock keeps the
    // old local ledger. Counting categories would lie when the owner approves a paper they have not
    // uploaded yet, so both providers count actual files.
    const isHttp = isHttpDomain('document');
    const shared = isHttp ? (updated?.sharedDocumentCount || 0) : countSharedDocs(mobile, [reqId]);
    if (shared > 0) {
      toast(t('dash.accessGrantedToast'), 'success');
    } else {
      toast(t('dash.approvedNoDocToast'), 'info');
    }
  };
  // Live docs carry a signed `url`; mock docs carry an inline `dataUrl`. Prefer whichever the
  // active provider filled. `openDocUrl` refuses anything it cannot safely render as a passive
  // document, including the dev storage stub host that never resolves in the browser (D120); a
  // refusal gets the same "no preview" toast the mock shows for a missing file (D125-5).
  const viewDoc = (doc) => {
    if (!openDocUrl(doc.url || doc.dataUrl)) toast(t('dash.noPreviewToast'));
  };
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
  // The header ring reflects the vault in view; while that vault is still loading its first read,
  // show it as indeterminate rather than a confident 0/N (D125-3).
  const vaultStatus = context === 'owner' ? ownerStatus : context === 'personal' ? personalStatus : 'ready';
  const vaultDocs = context === 'owner' ? ownerDocs : context === 'personal' ? personalDocs : [];
  const vaultLoading = vaultStatus === 'loading' && vaultDocs.length === 0;

  return (
    <div className="space-y-5">
      {/* ── Vault header: completeness ring + trust + context switch ── */}
      <div className="glass-card rounded-2xl p-5 sm:p-6 relative overflow-hidden">
        <div className="absolute -top-16 -right-10 w-56 h-56 rounded-full bg-teal-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
          <Ring done={headerDone} total={headerTotal} loading={vaultLoading} />
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
                  <button key={c} onClick={() => { contextChosen.current = true; setContext(c); }} className={'px-4 h-9 rounded-full text-xs font-semibold transition inline-flex items-center gap-1.5 ' + (context === c ? 'bg-brand-teal text-ink' : 'text-gray-400 hover:text-white')}>
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
          {ownerStatus === 'error' ? (
            <VaultError message={t('dash.vaultLoadError')} error={ownerError} onRetry={reloadOwner} t={t} />
          ) : ownerStatus === 'loading' && ownerDocs.length === 0 ? (
            <VaultSkeleton />
          ) : (
            OWNER_GROUPS.map((g) => (
              <CategoryCard key={g.id} group={g} docs={ownerDocs} open={!!openSections[g.id]} onToggle={toggle} onUpload={uploadForCategory} onRemove={removeDoc} onView={viewDoc} />
            ))
          )}

          <PanelCard id="ownerAgreements" icon="file-signature" tone="teal" title={t('dash.rentAgreement')}
            sub={selectedListing ? t('dash.agreementForProp', { title: selectedListing.title }) : t('dash.agreementForThis')}
            badge={propAgreements.length ? pill('bg-teal-500/15 text-teal-300', String(propAgreements.length)) : null}
            open={!!openSections.ownerAgreements} onToggle={toggle}>
            <AgreementList ras={propAgreements} emptyText={t('dash.noAgreementProp')} />
          </PanelCard>

          {/* The loan checklist is derived from the vault, so it only means anything once the vault
              is read — hiding it while loading/errored avoids a confident, wrong progress count. */}
          {ownerStatus === 'ready' && (
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
          )}

          {(docReqs.length > 0 || reqStatus === 'error') && (
            <PanelCard id="requests" icon="user-check" tone="teal" title={t('dash.docRequests')} sub={t('dash.docRequestsSub')}
              badge={reqStatus !== 'error' && pendingReqs > 0 ? pill('bg-amber-500/15 text-amber-300', t('dash.pendingCount', { count: pendingReqs })) : null}
              open={openSections.requests !== false} onToggle={toggle}>
              {reqStatus === 'error' ? (
                <VaultError message={t('dash.reqsLoadError')} error={reqError} onRetry={reloadReqs} t={t} />
              ) : (
                <div className="space-y-3">
                  {docReqs.map((r) => (
                    <div key={r.id} className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">{avatarFor(r.buyerName)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{r.buyerName}</p>
                        <p className="text-gray-500 text-xs">{t('dash.requestedLine', { docType: (r.categories || [r.docType]).join(', ') })} · {timeAgo(r.requestedAt)}</p>
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
              )}
            </PanelCard>
          )}

          <PanelCard id="payments" icon="indian-rupee" tone="emerald" title={t('dash.rentOnline')} sub={t('dash.rentOnlineSub')} open={!!openSections.payments} onToggle={toggle}>
            {(() => {
              /* Only settled rows. The badge used to read `entry.settlement || 'Settled'`, so a
                 row with no settlement — a failed or still-pending charge — was labelled settled by
                 the fallback. This is the owner's side of the same defect the Rent Wallet had
                 (D231): money that never moved, presented as money received. `settled` is
                 `rentMapper`'s single derivation of `status === 'paid'`, shared by both providers,
                 rather than a truthiness test on a field that happens to be absent. */
              const received = ledger.filter((entry) => entry.settled);
              return received.length ? (
                <div className="space-y-2">
                  {received.slice(0, 5).map((entry, i) => (
                    <div key={entry.id || i} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                      <div className="w-9 h-9 rounded-lg bg-emerald-400/15 flex items-center justify-center flex-shrink-0"><Icon name="check-circle" className="w-4 h-4 text-emerald-400" /></div>
                      <div className="flex-1 min-w-0"><p className="text-white text-sm font-medium">{fmtINR(entry.amount || 0)}</p><p className="text-gray-500 text-[11px] truncate">{t('dash.fromTenant', { name: rental.tenantNames[entry.tenancyId] || t('dash.tenantFallback') })} · {entry.paidDate ? timeAgo(entry.paidDate) : 'N/A'}</p></div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold flex-shrink-0">{t('dash.settled')}</span>
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
              <PropertyImage src={selectedTenancy.image} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
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
          {personalStatus === 'error' ? (
            <VaultError message={t('dash.vaultLoadError')} error={personalError} onRetry={reloadPersonal} t={t} />
          ) : personalStatus === 'loading' && personalDocs.length === 0 ? (
            <VaultSkeleton />
          ) : (
            <CategoryCard group={KYC_GROUP} docs={personalDocs} open={!!openSections.kyc} onToggle={toggle} onUpload={uploadForCategory} onRemove={removeDoc} onView={viewDoc} />
          )}
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
