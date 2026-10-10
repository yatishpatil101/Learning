import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../../../context/AuthContext.jsx';
import { hasPermission } from '../../../../lib/adminModules.js';
import { isInternal } from '../../../../lib/auth.js';
import { classNames } from '../../../../lib/format.js';
import {
  getOwnershipVerification, listOwnershipDocuments, recordOwnershipEvidence,
  verifyOwnership, revokeOwnershipVerification,
} from '../../../../services/propertyReviewService.js';
import BadgeDecisions from './ownership/BadgeDecisions.jsx';
import RecordedEvidence from './ownership/RecordedEvidence.jsx';
import RecordEvidenceForm from './ownership/RecordEvidenceForm.jsx';
import Section from './ownership/Section.jsx';
import UploadedDocuments from './ownership/UploadedDocuments.jsx';
import VerdictBanner from './ownership/VerdictBanner.jsx';
import { DOC_TYPES } from './ownership/vocabulary.js';

const EMPTY_FORM = { documentId: '', docType: '', issueDate: '', subjectName: '' };
const maskLast4 = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return `•••• ${digits.slice(-4)}`;
};

/** `propertyId` must be pid(listing): the UUID, not a public listing slug. */
export default function OwnershipEvidencePanel({ propertyId, listing, onRefresh, onVerification }) {
  const { user } = useAuth();
  const internal = isInternal(user);
  if (!internal || !hasPermission(user, 'properties:verify') || !propertyId) return null;
  return <OwnershipCase key={`${propertyId}:${user.id}`} propertyId={propertyId} listing={listing}
    actorId={user.id} onRefresh={onRefresh} onVerification={onVerification} />;
}

function OwnershipCase({ propertyId, listing, actorId, onRefresh, onVerification }) {
  const id = useId();
  const [reload, setReload] = useState(0);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(false);
  // A ref so a parent re-render never re-fetches the case.
  const onVerificationRef = useRef(onVerification);
  onVerificationRef.current = onVerification;
  const canDecide = Boolean(actorId && listing.ownerId && String(actorId) !== String(listing.ownerId));

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoadError('');
    Promise.all([getOwnershipVerification(propertyId), listOwnershipDocuments(propertyId)])
      .then(([verification, documents]) => {
        if (!Array.isArray(verification?.missingKinds) || !Array.isArray(verification?.evidence)
          || !Array.isArray(documents)) throw new Error('The ownership case response is incomplete.');
        if (!cancelled) setData({ verification, documents });
        if (!cancelled) onVerificationRef.current?.(verification);
      })
      .catch((cause) => {
        if (!cancelled) setLoadError(cause?.message || 'Could not load ownership evidence.');
      });
    return () => { cancelled = true; };
  }, [propertyId, reload]);

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
      onVerificationRef.current?.(verification);
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
  const needsSubject = form.docType === 'power_of_attorney';
  const canRecord = canDecide && selectedDocument && form.docType && form.issueDate
    && (!needsSubject || form.subjectName.trim());
  const record = (event) => {
    event.preventDefault();
    if (!canRecord) return;
    runDecision('record', () => recordOwnershipEvidence(propertyId, {
      documentId: form.documentId, docType: form.docType,
      issuedOn: form.issueDate,
      issuedAt: new Date(`${form.issueDate}T00:00:00+05:30`).toISOString(),
      ...(needsSubject ? { subjectName: form.subjectName.trim() } : {}),
    }), 'Evidence recorded. This action does not grant ownership verification.');
  };

  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-heading`} className="flex items-center gap-2 text-sm font-bold text-gray-100">
          <ShieldCheck className="h-4 w-4 text-brand-teal" aria-hidden="true" /> Ownership document checks
        </h3>
        <button type="button" onClick={refresh} disabled={Boolean(pending)} className="dz-btn dz-btn-ghost dz-btn-sm">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh documents
        </button>
      </div>
      {!canDecide && <p role="note" className="mb-3 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{listing.ownerId ? 'You cannot record, grant or withdraw verification for your own listing. Ask another reviewer.' : 'Lister identity is unavailable. Refresh the listing before making a decision.'}</p>}
      {loadError ? (
        <div><p role="alert" className="text-sm text-rose-300">{loadError}</p>
          <button type="button" onClick={refresh} className="dz-btn dz-btn-ghost mt-2">Retry ownership evidence</button>
        </div>
      ) : !data ? <p role="status" className="text-sm text-gray-300">Loading ownership evidence…</p> : (
        <>
          <VerdictBanner verification={verification} panelId={id} />
          <div className="mt-1 divide-y divide-white/10">
            <Section title="Compare against every document">
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                <Fact label="Lister" value={listing.owner} />
                <Fact label="MSEDCL consumer no." mono value={maskLast4(listing.electricityConsumerNo)} fallback="Not entered — read it off the bill" />
                <Fact label="Property address" value={[listing.address, listing.locality, listing.pincode].filter(Boolean).join(', ')} />
              </dl>
              <details className="group mt-3 text-xs">
                {/* The chevron is the only affordance: this theme suppresses the native summary marker. */}
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-semibold text-teal-300 hover:text-teal-200 [&::-webkit-details-marker]:hidden">
                  What counts as proof for {listing.deal === 'buy' ? 'a sale' : 'a rental'} listing
                  <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-1.5 leading-relaxed text-gray-400">
                  {listing.deal === 'buy'
                    ? 'Title proof (Index II for flats, recent Mahabhumi records for plots/land) plus a current electricity bill or property tax receipt. A sale deed and POA are supporting only.'
                    : 'A current electricity bill or property tax receipt in the lister’s name.'}
                  {' '}Read the consumer number off the original MSEDCL PDF; a screenshot or upload date proves nothing.
                </p>
              </details>
            </Section>

            <div className="grid gap-x-6 sm:grid-cols-2">
              <Section title="Owner's documents" meta={`${documents.length} uploaded`}>
                <UploadedDocuments propertyId={propertyId} documents={documents} />
              </Section>
              <Section title="Recorded checks" meta={`${verification.evidence.filter((row) => row.current).length} current`}>
                <RecordedEvidence evidence={verification.evidence} documents={documents} />
              </Section>
            </div>

            <Section title="Record a checked document">
              <RecordEvidenceForm id={id} documents={documents} form={form} setForm={setForm}
                pending={pending} canDecide={canDecide} canRecord={canRecord} needsSubject={needsSubject}
                onChangeDocument={changeDocument} onChangeDocType={changeDocType} onSubmit={record} />
            </Section>

            <Section title="Badge decision">
              <BadgeDecisions id={id} verification={verification} pending={pending} canDecide={canDecide}
                reason={reason} setReason={setReason}
                onGrant={() => runDecision('grant', () => verifyOwnership(propertyId), 'Ownership verification granted.')}
                onWithdraw={(text) => runDecision('revoke', () => revokeOwnershipVerification(propertyId, text), 'Ownership verification withdrawn.')} />
            </Section>
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {/* Only when there is something to announce: an always-mounted status region collides with
          the loading one, which makes a bare `getByRole('status')` ambiguous for that window. */}
      {notice && <p role="status" className="mt-3 text-sm text-teal-300">{notice}</p>}
      <p className="text-[11px] text-gray-500">Staff only. Document checks are not a legal title guarantee.</p>
    </section>
  );
}

/** An absent fact is styled as absent; the reviewer must never read a gap as a value. */
function Fact({ label, value, fallback = 'Not provided', mono }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-gray-500">{label}</dt>
      <dd className={classNames('mt-0.5 break-words text-sm', value
        ? classNames('font-semibold text-gray-100', mono && 'break-all font-mono')
        : 'italic text-gray-500')}>{value || fallback}</dd>
    </div>
  );
}
