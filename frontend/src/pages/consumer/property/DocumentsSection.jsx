import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { getDocRequests, addDocRequest } from '../../../lib/data/documents.js';
import { docsFor, commercialProfileFromType } from '../list-property/constants.js';
import { propertyKind } from './derivations.js';

/* Documents tab. Papers are never openly viewable — the owner personally approves
   which documents each buyer/tenant may see. The document set is deal + type aware
   (reusing the same source of truth as the listing flow, `docsFor`): a sale surfaces
   the title-chain papers a buyer's lawyer checks, while a rental only needs proof of
   ownership (+ an optional society NOC), so a tenant is never shown sale-only papers
   that were never collected. `docsCount` decides how many the owner has provided. */

// Sale (built-property) checklist, framed as buyer due-diligence.
const SALE_DOCS = [
  { name: 'Sale Deed', icon: 'file-signature', proves: 'Legal proof the ownership was transferred to the seller.' },
  { name: 'Index II', icon: 'landmark', proves: 'Government registration summary of the property.' },
  { name: 'Property Tax Receipt', icon: 'receipt-indian-rupee', proves: 'Municipal tax is paid and up to date.' },
  { name: 'Encumbrance Certificate', icon: 'file-search', proves: 'Confirms no outstanding loans or dues on the title.' },
  { name: 'Occupancy Certificate', icon: 'building-2', proves: 'Municipal clearance to legally occupy the property.' },
  { name: 'Society NOC', icon: 'users', proves: 'Dues cleared and the transfer is approved.' },
  { name: 'Approved Layout Plan', icon: 'clipboard-list', proves: 'Sanctioned building/layout drawing.' },
];

// Icon + fallback blurb per document key used by the deal/type-aware doc sets
// (rent + non-residential sale). Residential sale keeps the curated SALE_DOCS above.
const DOC_ICON = {
  'Ownership Proof': 'file-check', 'Society NOC': 'users', 'Fire NOC': 'shield-check',
  'Shop Act License': 'clipboard-list', 'MPCB Consent': 'shield-check', 'Factory License': 'clipboard-list',
  '7/12 Extract': 'landmark', '8A Extract': 'landmark', 'NA Order': 'file-check', 'Mutation Entry': 'file-search',
  'Index II': 'landmark', 'Occupancy Certificate': 'building-2', 'Sanctioned Building Plan': 'clipboard-list',
  'Property Tax Receipt': 'receipt-indian-rupee', 'Land Revenue Receipt': 'receipt-indian-rupee',
  'Electricity Bill': 'zap', 'PG Trade License': 'clipboard-list',
};
// Plain-language explanation per document, written from the seeker's side —
// what it proves / what PuneNest checked — not the owner-side upload hints.
const DOC_PROVES = {
  'Ownership Proof': 'PuneNest confirmed the person listing genuinely owns this property — you deal with the real owner, not a broker.',
  'Society NOC': 'The society permits this home to be let out — no surprise objection after you move in.',
  'Fire NOC': 'Fire / trade safety clearance is in place for this unit.',
  'Shop Act License': 'A valid Shop Act (Gumasta) licence covers commercial use here.',
  'MPCB Consent': 'Pollution-control consent is in place for industrial use.',
  'Factory License': 'Licensed to run a manufacturing / industrial unit here.',
  '7/12 Extract': 'The core Maharashtra land record confirms genuine ownership.',
  '8A Extract': 'Village holding record confirming the cultivator’s account.',
  'NA Order': 'Confirms the plot is sanctioned for non-agricultural use.',
  'Mutation Entry': 'Records the latest ownership change in the revenue records.',
  'Index II': 'Government registration summary — confirms the recorded ownership.',
  'Occupancy Certificate': 'Municipal clearance that the building is legal to occupy and use.',
  'Sanctioned Building Plan': 'The sanctioned plan — confirms the built structure is approved.',
  'Property Tax Receipt': 'Municipal tax is paid — corroborates the owner’s claim to the property.',
  'Land Revenue Receipt': 'Land revenue is paid — corroborates ownership of the land.',
  'Electricity Bill': 'An active connection with dues cleared.',
  'PG Trade License': 'A valid trade licence covers running this PG legally.',
};

// Map a detail-page listing to the canonical property-type key docsFor expects.
function docPtype(p) {
  const kind = propertyKind(p);
  if (kind === 'land') return /farm/i.test(p.type || '') ? 'farmland' : 'openplot';
  if (kind === 'commercial') return 'commercial';
  return /pg|hostel/i.test(p.type || '') ? 'pg' : 'flat';
}
// A representative commercial subtype so docsFor appends the right profile docs
// (industrial → MPCB/Factory, retail → Shop Act). Only consulted for sale (buy).
const PROFILE_SUBTYPE = { workspace: 'office', retail: 'shop', industrial: 'warehouse' };
const buildDocs = (p, deal) => docsFor(
  deal, docPtype(p), deal === 'buy' ? (p.commercialType || PROFILE_SUBTYPE[commercialProfileFromType(p.type)]) : undefined,
).map((d) => ({
  name: d.key,
  icon: DOC_ICON[d.key] || 'file-check',
  proves: DOC_PROVES[d.key] || d.hint || 'Checked by PuneNest as part of verifying this listing.',
}));

// Owner-approval state for each document, as reflected back to the buyer.
// labelKey resolves to property.<key> at render (component chrome is translated).
const ACCESS = {
  granted: { labelKey: 'accessGranted', icon: 'eye', cls: 'text-emerald-300' },
  pending: { labelKey: 'accessPending', icon: 'clock', cls: 'text-amber-300' },
  declined: { labelKey: 'accessDeclined', icon: 'lock', cls: 'text-slate-400' },
  none: { labelKey: 'accessNone', icon: 'lock', cls: 'text-slate-400' },
};

export function DocumentsSection({ p, user, isIn, toast }) {
  const { t } = useTranslation();
  const isRent = p.deal === 'rent';
  const count = p.docsCount || 0;
  const [, refresh] = useState(0);
  const [ack, setAck] = useState(false);
  if (!count) return null;
  // Residential sale keeps the curated buyer due-diligence checklist; commercial/land
  // sale derives its title-chain from docsFor so a buyer never sees a flat's Society NOC
  // / Share Certificate on an office or a plot. Rent is already fully type-aware.
  const docs = (isRent
    ? buildDocs(p, 'rent')
    : (propertyKind(p) === 'residential' ? SALE_DOCS : buildDocs(p, 'buy'))
  ).slice(0, count);
  const seeker = isRent ? 'tenant' : 'buyer';

  // This buyer's outstanding requests to the owner → per-document access state.
  const myReqs = getDocRequests(p.ownerMobile).filter((r) => r.propId === p.id && r.buyerMobile === user?.mobile);
  const statusOf = (name) => myReqs.find((r) => r.docType === name)?.status || 'none';
  const requested = myReqs.length > 0;
  const grantedReqs = myReqs.filter((r) => r.status === 'granted');
  const grantedCount = grantedReqs.length;
  // Reliable in-app entry to the view-only viewer once the owner has approved. Uses
  // digits so the link matches the owner key the viewer reads, independent of any
  // notification arriving.
  const viewDocsLink = grantedCount > 0
    ? `/view-documents?o=${(p.ownerMobile || '').replace(/\D/g, '')}&r=${grantedReqs[0].id}`
    : null;

  const requestAccess = () => {
    if (!isIn) { toast(t('property.signInDocs'), 'info'); return; }
    if (!ack) { toast(t('property.ackFirst'), 'info'); return; }
    docs.forEach((d) => addDocRequest(p.ownerMobile, { propId: p.id, buyerName: user?.name, buyerMobile: user?.mobile, docType: d.name, acknowledgedDisclaimer: true }));
    refresh((n) => n + 1);
    toast(t('property.docsRequestSent'), 'success');
  };

  return (
    <section className="fade-in section-mb">
      <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 flex items-center gap-2"><Icon name={isRent ? 'shield-check' : 'folder-check'} className="w-5 h-5 text-brand-teal-2" /> {isRent ? t('property.verifiedForRenting') : t('property.documentsProvided')}</h2>
      <div className="glass rounded-2xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-brand-teal-1/20 flex items-center justify-center flex-shrink-0"><Icon name="shield-check" className="w-6 h-6 text-brand-teal-3" /></div>
            <div>
              <p className="font-bold text-white text-lg">{isRent ? t('property.verifiedByPuneNest') : t('property.documentBacked')}</p>
              <p className="text-xs text-slate-400 mt-0.5">{isRent ? t('property.docsSubRent') : t('property.docsSubBuy')}</p>
            </div>
          </div>
          <span className="tag tag-emerald flex items-center gap-1.5"><Icon name={isRent ? 'shield-check' : 'file-text'} className="w-3.5 h-3.5" /> {isRent ? t('property.checks', { count: docs.length }) : t('property.documents', { count: docs.length })}</span>
        </div>

        {/* Persistent notice: rent is verification-only; sale is owner-gated document sharing. */}
        <div className="rounded-xl border border-brand-teal-2/20 p-3.5 flex items-start gap-2.5 mb-5" style={{ background: 'rgba(20,184,166,.06)' }}>
          <Icon name={isRent ? 'shield-check' : 'user-check'} className="w-4 h-4 text-brand-teal-3 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-slate-300 leading-relaxed">{isRent
            ? (<><span className="font-semibold text-white">{t('property.noticeRentBold')}</span>{t('property.noticeRentBody')}</>)
            : (<><span className="font-semibold text-white">{t('property.noticeBuyBold')}</span>{t('property.noticeBuyBody', { seeker: isRent ? t('property.seekerTenant') : t('property.seekerBuyer') })}</>)}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {docs.map((d) => {
            const a = ACCESS[statusOf(d.name)];
            return (
              <div key={d.name} className="rounded-xl border border-white/8 bg-white/[0.03] p-4 flex items-start gap-3 transition-smooth hover:border-brand-teal-2/25">
                <span className="w-9 h-9 rounded-lg bg-brand-teal/10 flex items-center justify-center flex-shrink-0">
                  <Icon name={d.icon} className="w-4 h-4 text-brand-teal-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white truncate">{d.name}</p>
                    <span title={t('property.docVerifiedTitle')} className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 flex-shrink-0 cursor-help"><Icon name="check" className="w-3.5 h-3.5" /> {t('property.verified')}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{d.proves}</p>
                  {!isRent && (
                    <span className={'inline-flex items-center gap-1 text-[11px] font-medium mt-2 ' + a.cls}><Icon name={a.icon} className="w-3 h-3" /> {t('property.' + a.labelKey)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {isRent ? (
          <div className="mt-6 flex items-start gap-1.5 pt-5 border-t border-white/10">
            <Icon name="info" className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
            <p className="text-slate-500 text-xs leading-relaxed">{t('property.rentDocsFooter')}</p>
          </div>
        ) : (
          <div className="mt-6 pt-5 border-t border-white/10">
            <p className="text-slate-500 text-xs flex items-start gap-1.5 mb-3"><Icon name="lock" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {t('property.buyDocsPrivacy')}</p>
            {requested ? (
              <div className="flex flex-col gap-3">
                <div className="inline-flex items-center gap-2 text-sm rounded-xl border border-brand-teal-2/30 px-4 py-3 self-start" style={{ background: 'rgba(20,184,166,.06)' }}>
                  <Icon name={grantedCount > 0 ? 'badge-check' : 'clock'} className={'w-4 h-4 ' + (grantedCount > 0 ? 'text-emerald-300' : 'text-brand-teal-3')} />
                  <span className="text-slate-200 font-medium">{grantedCount > 0 ? t('property.ownerApprovedOf', { granted: grantedCount, total: docs.length }) : t('property.requestSentReviewing')}</span>
                </div>
                {viewDocsLink && (
                  <Link to={viewDocsLink} className="btn-teal inline-flex items-center gap-2 whitespace-nowrap py-3 px-5 text-sm self-start">
                    <Icon name="folder-lock" className="w-4 h-4" /> {t('property.viewSharedDocs')}
                  </Link>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <label className="flex items-start gap-2.5 cursor-pointer min-h-[44px] py-2 sm:min-h-0 sm:py-0">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="accent-brand-teal-2 w-5 h-5 sm:w-4 sm:h-4 mt-0.5 flex-shrink-0" />
                  <span className="text-xs text-slate-300 leading-relaxed">{t('property.ackPre')}<span className="font-semibold text-white">{t('property.ackBold')}</span>{t('property.ackPost')}</span>
                </label>
                <button type="button" onClick={requestAccess} disabled={!ack} className="btn-teal flex items-center justify-center gap-2 whitespace-nowrap py-3 px-5 text-sm self-start disabled:opacity-50 disabled:cursor-not-allowed"><Icon name="send" className="w-4 h-4" /> {t('property.requestToViewDocs')}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
