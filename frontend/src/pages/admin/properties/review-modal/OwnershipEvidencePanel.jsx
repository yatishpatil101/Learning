import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../../../context/AuthContext.jsx';
import { canWriteModule } from '../../../../lib/adminModules.js';
import { classNames } from '../../../../lib/format.js';
import {
  getOwnershipVerification, listOwnershipDocuments, recordOwnershipEvidence,
  verifyOwnership, revokeOwnershipVerification,
} from '../../../../services/propertyReviewService.js';
import BadgeDecisions from './ownership/BadgeDecisions.jsx';
import RecordedEvidence from './ownership/RecordedEvidence.jsx';
import RecordEvidenceForm from './ownership/RecordEvidenceForm.jsx';
import Step from './ownership/Step.jsx';
import UploadedDocuments from './ownership/UploadedDocuments.jsx';
import VerdictBanner from './ownership/VerdictBanner.jsx';
import { DOC_TYPES } from './ownership/vocabulary.js';

const EMPTY_FORM = { documentId: '', docType: '', issueDate: '', subjectName: '' };

/* File links are signed and expire, and a review outlives them — a stale link leads to the object
   store's 403 page instead of the scan. Re-fetching on a timer would record a disclosure nobody
   asked for, so the panel stops offering a link it can no longer vouch for and points at the
   refresh. Kept under the shortest lifetime the server signs, so the margin absorbs clock skew. */
const LINK_LIFETIME_MS = 10 * 60 * 1000;
/** `propertyId` must be pid(listing): the UUID, not a public listing slug. */
export default function OwnershipEvidencePanel({ propertyId, listing, onRefresh }) {
  const { user } = useAuth();
  const isStaff = user?.role === 'staff' || user?.role === 'admin';
  if (!isStaff || !canWriteModule(user, 'properties') || !propertyId) return null;
  return <OwnershipCase key={`${propertyId}:${user.id}`} propertyId={propertyId} listing={listing}
    actorId={user.id} onRefresh={onRefresh} />;
}

function OwnershipCase({ propertyId, listing, actorId, onRefresh }) {
  const id = useId();
  const [reload, setReload] = useState(0);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [linksExpired, setLinksExpired] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const canDecide = Boolean(actorId && listing.ownerId && String(actorId) !== String(listing.ownerId));

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoadError('');
    setLinksExpired(false);
    const ageOut = setTimeout(() => setLinksExpired(true), LINK_LIFETIME_MS);
    Promise.all([getOwnershipVerification(propertyId), listOwnershipDocuments(propertyId)])
      .then(([verification, documents]) => {
        if (!Array.isArray(verification?.missingKinds) || !Array.isArray(verification?.evidence)
          || !Array.isArray(documents)) throw new Error('The ownership case response is incomplete.');
        if (!cancelled) setData({ verification, documents });
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(cause?.message || 'Could not load ownership evidence.');
      });
    return () => { cancelled = true; clearTimeout(ageOut); };
  }, [propertyId, reload]);

  /* Keeps whatever the reviewer has typed. The expired-link copy sends them here, and ten minutes
     of reading a scan is exactly how long it takes to have a date and a subject name half-entered;
     re-fetching the same vault rows does not invalidate a choice made from them. */
  const refresh = () => {
    setError('');
    setNotice('');
    setReload((value) => value + 1);
  };

  const changeDocument = (documentId) => {
    const picked = (data?.documents || []).find((row) => row.id === documentId);
    const docType = DOC_TYPES.find((type) => type.category.toLowerCase() === picked?.category?.toLowerCase())?.value || '';
    // UploadedAt is not an issue date; every newly selected file needs its date read by the reviewer.
    setForm({ ...EMPTY_FORM, documentId, docType });
  };

  // A subject name belongs to the document it was read off, so switching type discards it.
  const changeDocType = (docType) => setForm((previous) => ({ ...previous, docType, subjectName: '' }));

  const runDecision = async (action, operation, message) => {
    if (inFlight.current || !canDecide) return;
    inFlight.current = true;
    setPending(action);
    setError('');
    setNotice('');
    try {
      const verification = await operation();
      /* Same assertion the load path makes, for the same reason: three sections dereference these
         arrays, and a response short of one would blank the modal just after the write committed. */
      if (!Array.isArray(verification?.missingKinds) || !Array.isArray(verification?.evidence)) {
        throw new Error('The ownership case response is incomplete.');
      }
      if (!mounted.current) return;
      setData((previous) => ({ ...previous, verification }));
      setNotice(message);
      if (action === 'record') setForm(EMPTY_FORM);
      if (action === 'revoke') setReason('');
      try {
        await onRefresh?.();
      } catch {
        if (mounted.current) setError('Decision saved, but the listing queue could not refresh. Reload the queue before reviewing another listing.');
      }
    } catch (cause) {
      if (mounted.current) setError(cause?.message || 'Could not save the ownership decision. Retry the action or refresh the case.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending('');
    }
  };

  const verification = data?.verification;
  const documents = data?.documents || [];
  const selectedDocument = documents.find((file) => file.id === form.documentId);
  const needsSubject = form.docType === 'aadhaar' || form.docType === 'pan';
  const canRecord = canDecide && selectedDocument && form.docType && form.issueDate
    && (!needsSubject || form.subjectName.trim());
  const record = (event) => {
    event.preventDefault();
    if (!canRecord) return;
    runDecision('record', () => recordOwnershipEvidence(propertyId, {
      documentId: form.documentId, docType: form.docType,
      issuedOn: form.issueDate,
      ...(needsSubject ? { subjectName: form.subjectName.trim() } : {}),
    }), 'Evidence recorded. This action does not grant ownership verification.');
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-2xl border border-teal-400/25 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-heading`} className="flex items-center gap-2 text-sm font-bold text-gray-100">
          <ShieldCheck className="h-4 w-4 text-brand-teal" aria-hidden="true" /> Ownership document checks
        </h3>
        <button type="button" onClick={refresh} disabled={Boolean(pending)} className="dz-btn dz-btn-ghost min-h-[44px]">
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh documents
        </button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-gray-400">Staff only. Document checks are not a legal title guarantee. Recording evidence and granting the badge are separate decisions.</p>
      {!canDecide && <p role="note" className="mt-3 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{listing.ownerId ? 'You cannot record, grant or withdraw verification for your own listing. Ask another reviewer.' : 'Lister identity is unavailable. Refresh the listing before making a decision.'}</p>}
      {loadError ? (
        <div className="mt-4"><p role="alert" className="text-sm text-rose-300">{loadError}</p>
          <button type="button" onClick={refresh} className="dz-btn dz-btn-ghost mt-2">Retry ownership evidence</button>
        </div>
      ) : !data ? <p role="status" className="mt-4 text-sm text-gray-300">Loading ownership evidence…</p> : (
        <div className="mt-4 space-y-3">
          <VerdictBanner verification={verification} panelId={id} />

          <Step n={1} title="Compare these against every document">
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg bg-white/10 sm:grid-cols-2">
              <Fact label="Lister" value={listing.owner} />
              <Fact label="MSEDCL consumer number" mono value={listing.electricityConsumerNo} fallback="Not provided — ask the lister" />
              <Fact className="sm:col-span-2" label="Property address"
                value={[listing.address, listing.locality, listing.pincode].filter(Boolean).join(' · ')} />
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-amber-200">Open the original MSEDCL PDF and read the consumer number off it. A screenshot or an upload date proves nothing.</p>
            <details className="group mt-2.5 rounded-lg border border-white/10 bg-white/[0.02]">
              {/* The chevron is the only affordance: this theme suppresses the native summary marker. */}
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-300 hover:text-white [&::-webkit-details-marker]:hidden">
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0 transition-transform group-open:rotate-180" />
                What counts as proof for {listing.deal === 'buy' ? 'a sale' : 'a rental'} listing
              </summary>
              <p className="border-t border-white/10 px-3 py-2 text-xs leading-relaxed text-gray-400">
                {listing.deal === 'buy'
                  ? 'Sale requires Index II plus a current electricity bill or property tax receipt. A sale deed is supporting only, not a substitute for Index II.'
                  : 'Rent requires a current electricity bill or property tax receipt in the lister’s name.'}
                {' '}Identity and site documents are optional supporting evidence.
              </p>
            </details>
          </Step>

          <Step n={2} title="Documents on file" meta={`${documents.length} uploaded · ${verification.evidence.filter((row) => row.current).length} current`}>
            <h5 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">Uploaded by the lister</h5>
            <UploadedDocuments documents={documents} linksExpired={linksExpired} />
            <h5 className="mb-2 mt-3.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">Recorded evidence</h5>
            <RecordedEvidence evidence={verification.evidence} documents={documents} />
          </Step>

          <Step n={3} title="Record a checked document">
            <RecordEvidenceForm id={id} documents={documents} form={form} setForm={setForm}
              pending={pending} canDecide={canDecide} canRecord={canRecord} needsSubject={needsSubject}
              onChangeDocument={changeDocument} onChangeDocType={changeDocType} onSubmit={record} />
          </Step>

          <Step n={4} title="Badge decision">
            <BadgeDecisions id={id} verification={verification} pending={pending} canDecide={canDecide}
              reason={reason} setReason={setReason}
              onGrant={() => runDecision('grant', () => verifyOwnership(propertyId), 'Ownership verification granted.')}
              onWithdraw={(text) => runDecision('revoke', () => revokeOwnershipVerification(propertyId, text), 'Ownership verification withdrawn.')} />
          </Step>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {/* Only when there is something to announce: an always-mounted status region collides with
          the loading one, which makes a bare `getByRole('status')` ambiguous for that window. */}
      {notice && <p role="status" className="mt-3 text-sm text-teal-300">{notice}</p>}
    </section>
  );
}

/** An absent fact is styled as absent; the reviewer must never read a gap as a value. */
function Fact({ label, value, fallback = 'Not provided', mono, className }) {
  return (
    <div className={classNames('bg-ink-2 p-2.5', className)}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={classNames('mt-0.5 break-words text-sm', value
        ? classNames('font-semibold text-gray-100', mono && 'break-all font-mono')
        : 'italic text-gray-500')}>{value || fallback}</p>
    </div>
  );
}
