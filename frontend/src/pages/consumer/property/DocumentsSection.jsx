import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import {
  listMyDocumentRequests, requestDocumentAccess,
} from '../../../services/documentService.js';
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
// what it proves / what Draazy checked — not the owner-side upload hints.
const DOC_PROVES = {
  'Ownership Proof': 'Draazy confirmed the person listing genuinely owns this property — you deal with the real owner, not a broker.',
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
  proves: DOC_PROVES[d.key] || d.hint || 'Checked by Draazy as part of verifying this listing.',
}));

// Owner-approval state for each document, as reflected back to the buyer.
// labelKey resolves to property.<key> at render (component chrome is translated).
//
// `expired` is a fifth state and it is not a background-job label: `DocumentRequestMapper
// .projectedStatus` derives it on every read by comparing `expiresAt` to the clock, so a request
// granted more than `GRANT_TTL` (7 days) ago arrives here as `expired` without anything having
// written to the row. It reads as a lapse rather than a refusal — the owner said yes and the window
// has closed — so it takes the neutral slate treatment rather than declined's, and its own wording.
const ACCESS = {
  granted: { labelKey: 'accessGranted', icon: 'eye', cls: 'text-emerald-300' },
  pending: { labelKey: 'accessPending', icon: 'clock', cls: 'text-amber-300' },
  declined: { labelKey: 'accessDeclined', icon: 'lock', cls: 'text-slate-400' },
  expired: { labelKey: 'accessExpired', icon: 'clock', cls: 'text-slate-400' },
  none: { labelKey: 'accessNone', icon: 'lock', cls: 'text-slate-400' },
};

/**
 * `ACCESS` as a total function of whatever string the server put on the request.
 *
 * The map is a client-side transcription of a server-side vocabulary and the two have already
 * drifted once, over `expired`. An unmapped status must not take the chip's row down: reading
 * `.cls` off `undefined` throws inside the `.map` callback below, which unmounts the whole
 * documents card and with it the request button the buyer needs. Falling back to `none`
 * understates rather than overstates.
 *
 * `Object.hasOwn`, not `ACCESS[status] ||` — `constructor`, `toString` and `valueOf` are all
 * truthy on a plain object, so the `||` form would sail past the guard for exactly the unexpected
 * inputs it exists to catch and hand the chip an `undefined` className.
 *
 * Warned once per unrecognised value, because the caller is a `.map` that re-runs on every ack
 * toggle and every re-render (twice over in StrictMode) — a repeating wall buries the one line
 * that names the table to update.
 */
const warnedStatuses = new Set();
function accessFor(status) {
  if (Object.hasOwn(ACCESS, status)) return ACCESS[status];
  if (!warnedStatuses.has(status)) {
    warnedStatuses.add(status);
    console.warn(`[DocumentsSection] unmapped access status "${status}" — add it to ACCESS`);
  }
  return ACCESS.none;
}

export function DocumentsSection({ p, user, isIn, toast }) {
  const { t } = useTranslation();
  const isRent = p.deal === 'rent';
  const count = p.docsCount || 0;
  const [ack, setAck] = useState(false);
  const [myReqs, setMyReqs] = useState([]);
  const [requestsStatus, setRequestsStatus] = useState('loading');
  const [requestReload, setRequestReload] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const requestingRef = useRef(false);
  const requestPropertyId = p.uuid || p.id;

  useEffect(() => {
    if (!isIn || !user?.mobile || !p.id) {
      setMyReqs([]);
      setRequestsStatus('ready');
      return undefined;
    }
    let alive = true;
    setRequestsStatus('loading');
    listMyDocumentRequests({ ownerMobile: p.ownerMobile, buyerMobile: user.mobile })
      .then((rows) => {
        if (alive) {
          setMyReqs((rows || []).filter((request) => request.propId === requestPropertyId));
          setRequestsStatus('ready');
        }
      })
      .catch(() => {
        if (alive) setRequestsStatus('error');
      });
    return () => { alive = false; };
  }, [isIn, p.id, p.ownerMobile, requestPropertyId, requestReload, user?.mobile]);

  if (!count) return null;
  // Residential sale keeps the curated buyer due-diligence checklist; commercial/land
  // sale derives its title-chain from docsFor so a buyer never sees a flat's Society NOC
  // / Share Certificate on an office or a plot. Rent is already fully type-aware.
  const docs = (isRent
    ? buildDocs(p, 'rent')
    : (propertyKind(p) === 'residential' ? SALE_DOCS : buildDocs(p, 'buy'))
  ).slice(0, count);
  const seeker = isRent ? 'tenant' : 'buyer';

  // One server request carries a list of categories. Folding each row over that list gives the
  // existing per-document chips without inventing a second status map in the DTO.
  // First match wins, and the server returns newest-first (`DocumentRequestRepository.java:33`), so
  // a fresh pending row correctly beats an older expired one for the same category. That ordering
  // is load-bearing here.
  const statusOf = (name) => myReqs.find((request) =>
    (request.categories || [request.docType]).includes(name))?.status || 'none';
  /* Expired rows are history, not a request in flight. `requested` gates the whole ask affordance
     away, so counting them kept the buyer on "Request sent — the owner is reviewing" forever while
     the chips beside it read "Access window closed", and left no way to ask again. `projectedStatus`
     derives `expired` from the clock on every read, so this state arrives on its own, for every
     buyer who waited out `GRANT_TTL`. */
  const liveReqs = myReqs.filter((request) => request.status !== 'expired');
  const requested = liveReqs.length > 0;
  const lapsed = myReqs.length > 0 && liveReqs.length === 0;
  const grantedReqs = myReqs.filter((r) => r.status === 'granted');
  const grantedCount = docs.filter((document) => statusOf(document.name) === 'granted').length;
  /* "The owner is reviewing" is only true while something is actually pending. A declined request
     kept `requested` true and fell through to that copy, so a buyer the owner had refused was told
     indefinitely that an answer was coming — the buyer-side twin of the "Declined" mislabel the
     owner's ladder just lost. The button stays hidden for a decline: V20's pending-only index does
     permit asking again ("a total UNIQUE would make 'no' permanent"), but re-offering it one click
     from a refusal is an owner-harassment path, so the affordance is a product decision filed in
     tasks/todo.md rather than something to add here. */
  const declined = requested && liveReqs.every((request) => request.status === 'declined');
  // Requester-scoped rather than owner-mobile scoped: possession of an id buys nothing; the API
  // also requires the JWT to identify the buyer who wrote this exact request.
  const viewDocsLink = grantedCount > 0
    ? `/view-documents/${encodeURIComponent(grantedReqs[0].id)}`
    : null;

  const requestAccess = async () => {
    if (!isIn) { toast(t('property.signInDocs'), 'info'); return; }
    if (!ack) { toast(t('property.ackFirst'), 'info'); return; }
    if (requestingRef.current) return;
    requestingRef.current = true;
    setRequesting(true);
    try {
      await requestDocumentAccess({
        ownerMobile: p.ownerMobile,
        propertyId: requestPropertyId,
        buyerName: user?.name,
        buyerMobile: user?.mobile,
        categories: docs.map((document) => document.name),
        acknowledgedDisclaimer: true,
      });
      const rows = await listMyDocumentRequests({
        ownerMobile: p.ownerMobile,
        buyerMobile: user?.mobile,
      });
      setMyReqs((rows || []).filter((request) => request.propId === requestPropertyId));
      setRequestsStatus('ready');
      toast(t('property.docsRequestSent'), 'success');
    } catch {
      toast(t('property.docsRequestFailed'), 'error');
    } finally {
      requestingRef.current = false;
      setRequesting(false);
    }
  };

  return (
    <section className="fade-in section-mb">
      <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 flex items-center gap-2"><Icon name={isRent ? 'shield-check' : 'folder-check'} className="w-5 h-5 text-brand-teal-2" /> {isRent ? t('property.verifiedForRenting') : t('property.documentsProvided')}</h2>
      <div className="glass rounded-2xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-brand-teal-1/20 flex items-center justify-center flex-shrink-0"><Icon name="shield-check" className="w-6 h-6 text-brand-teal-3" /></div>
            <div>
              <p className="font-bold text-white text-lg">{isRent ? t('property.verifiedByDraazy') : t('property.documentBacked')}</p>
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
            const a = accessFor(statusOf(d.name));
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
            {requestsStatus === 'error' && (
              <div role="alert" className="mb-3 rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                <p>{t('property.docsRequestLoadFailed')}</p>
                <button type="button" onClick={() => setRequestReload((value) => value + 1)} className="mt-2 text-xs font-semibold underline underline-offset-2">
                  {t('property.docsRequestRetry')}
                </button>
              </div>
            )}
            {requestsStatus === 'loading' && myReqs.length === 0 ? (
              <p className="text-sm text-slate-400">{t('property.docsRequestLoading')}</p>
            ) : requested ? (
              <div className="flex flex-col gap-3">
                <div className="inline-flex items-center gap-2 text-sm rounded-xl border border-brand-teal-2/30 px-4 py-3 self-start" style={{ background: 'rgba(20,184,166,.06)' }}>
                  <Icon name={grantedCount > 0 ? 'badge-check' : (declined ? 'x-circle' : 'clock')} className={'w-4 h-4 ' + (grantedCount > 0 ? 'text-emerald-300' : (declined ? 'text-slate-400' : 'text-brand-teal-3'))} />
                  <span className="text-slate-200 font-medium">{grantedCount > 0 ? t('property.ownerApprovedOf', { granted: grantedCount, total: docs.length }) : (declined ? t('property.requestDeclined') : t('property.requestSentReviewing'))}</span>
                </div>
                {viewDocsLink && (
                  <Link to={viewDocsLink} className="btn-teal inline-flex items-center gap-2 whitespace-nowrap py-3 px-5 text-sm self-start">
                    <Icon name="folder-lock" className="w-4 h-4" /> {t('property.viewSharedDocs')}
                  </Link>
                )}
              </div>
            ) : requestsStatus !== 'error' ? (
              <div className="flex flex-col gap-3">
                {lapsed && (
                  <p className="inline-flex items-center gap-2 text-sm rounded-xl border border-white/10 px-4 py-3 self-start text-slate-300">
                    <Icon name="clock" className="w-4 h-4 text-slate-400 flex-shrink-0" /> {t('property.accessLapsedRetry')}
                  </p>
                )}
                <label className="flex items-start gap-2.5 cursor-pointer min-h-[44px] py-2 sm:min-h-0 sm:py-0">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="accent-brand-teal-2 w-5 h-5 sm:w-4 sm:h-4 mt-0.5 flex-shrink-0" />
                  <span className="text-xs text-slate-300 leading-relaxed">{t('property.ackPre')}<span className="font-semibold text-white">{t('property.ackBold')}</span>{t('property.ackPost')}</span>
                </label>
                <button type="button" onClick={requestAccess} disabled={!ack || requesting} className="btn-teal flex items-center justify-center gap-2 whitespace-nowrap py-3 px-5 text-sm self-start disabled:opacity-50 disabled:cursor-not-allowed"><Icon name="send" className="w-4 h-4" /> {t('property.requestToViewDocs')}</button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
