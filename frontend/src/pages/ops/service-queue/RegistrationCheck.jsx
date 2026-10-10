import { useEffect, useId, useState } from 'react';
import { BadgeCheck, ExternalLink, ShieldAlert, X } from 'lucide-react';
import { openRequestDoc } from './helpers.js';
import { hasPermission } from '../../../lib/adminModules.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { listServiceRequestRentAgreements, verifyRentAgreement } from '../../../services/serviceRequestService.js';

const STATUS_LABEL = {
  draft: 'Awaiting check',
  'e-sign-pending': 'Awaiting e-sign',
  registered: 'Registered',
  active: 'Active',
  expired: 'Not registered',
};

const rupees = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);

function RegistrationRecord({ record }) {
  const off = [
    ['Stamp duty', record.stampDuty, record.quotedStampDuty],
    ['Registration fee', record.registrationFee, record.quotedRegistrationFee],
  ].filter(([, paid, quoted]) => quoted != null && paid !== quoted);
  return (
    <div className="mt-3 rounded-xl border border-white/5 p-3 text-sm" data-testid="registration-record">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-gray-500">Document no.</dt><dd className="text-gray-200">{record.documentNo}</dd>
        <dt className="text-gray-500">Sub-Registrar</dt><dd className="text-gray-200">{record.sro}</dd>
        <dt className="text-gray-500">Registered on</dt><dd className="text-gray-200">{record.registeredOn}</dd>
        <dt className="text-gray-500">GRAS GRN</dt><dd className="text-gray-200">{record.grn}</dd>
        <dt className="text-gray-500">Duty / fee paid</dt><dd className="text-gray-200">{rupees(record.stampDuty)} / {rupees(record.registrationFee)}</dd>
        <dt className="text-gray-500">Quoted</dt><dd className="text-gray-200">{rupees(record.quotedStampDuty)} / {rupees(record.quotedRegistrationFee)}</dd>
      </dl>
      {off.length ? (
        <p role="note" className="mt-2 text-xs text-amber-200">
          {off.map(([label, paid, quoted]) => `${label} paid ${rupees(paid)} differs from the ${rupees(quoted)} the customer was quoted.`).join(' ')}
          {' '}Check the challan before confirming.
        </p>
      ) : null}
      <p className="mt-2 text-xs text-gray-500">Recorded by {record.recordedBy || 'a former colleague'}</p>
    </div>
  );
}

/** Second-operator check keeps tenant trust badges draft-only until the registered copy is confirmed. */
export default function RegistrationCheck({ request, onError, onUnavailable }) {
  const titleId = useId();
  const { user } = useAuth();
  const canCheck = hasPermission(user, 'registrations:write');
  const [rows, setRows] = useState(null);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState('');
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    let current = true;
    listServiceRequestRentAgreements(request.id)
      .then((list) => { if (current) setRows(list); })
      .catch((err) => { if (current) setFailure(err?.message || 'The tenancy rows could not be read.'); });
    return () => { current = false; };
  }, [request.id]);

  const decide = async (row, status) => {
    if (busy) return;
    setBusy(row.id);
    try {
      const updated = await verifyRentAgreement(row.id, status);
      setRows((list) => list.map((r) => (r.id === updated.id ? updated : r)));
      setAnnouncement(`${row.tenantName || 'Tenant'}: ${STATUS_LABEL[updated.status] || updated.status}.`);
      requestAnimationFrame(() => document.getElementById(`${titleId}-${row.id}`)?.focus());
    } catch (err) {
      onError(err?.message || 'That could not be recorded.');
    } finally {
      setBusy('');
    }
  };

  const copyId = rows?.find((row) => row.documentId)?.documentId;

  return (
    <section className="rounded-2xl border border-white/10 p-4" aria-labelledby={titleId}>
      <h4 id={titleId} className="text-sm font-semibold">Registration check</h4>
      <p className="mt-1 text-xs text-gray-400">
        Open the registered copy these rows came from, compare it with the approved draft, and
        confirm each tenant is named on it. A registered tenancy gives the tenant a trust badge, so
        the person who uploaded the copy cannot confirm it.
      </p>
      {request.registration ? <RegistrationRecord record={request.registration} /> : null}
      {copyId ? (
        <button
          type="button"
          onClick={async () => { if (!(await openRequestDoc(request.id, copyId))) onUnavailable(); }}
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-sky-200 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open the registered copy
          <span className="sr-only"> (opens in a new tab)</span>
        </button>
      ) : null}
      <p role="status" className="sr-only">{announcement}</p>

      {failure ? (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{failure}</span>
        </div>
      ) : null}

      {!rows && !failure ? <p className="mt-3 text-sm text-gray-400">Reading the tenancy rows…</p> : null}

      {rows && rows.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">
          No tenant on this request can be recorded — the form named no valid tenant mobile, or the
          listing&rsquo;s owner took no part — so there is nothing to check.
        </p>
      ) : null}

      {rows?.length ? (
        <ul className="mt-3 space-y-2" aria-busy={!!busy}>
          {rows.map((row) => {
            const who = row.tenantName || 'Tenant';
            return (
              <li key={row.id} className="rounded-xl border border-white/5 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-gray-200">
                    {who} <span className="text-gray-500">· {row.tenantMobile}</span>
                  </span>
                  <span id={`${titleId}-${row.id}`} tabIndex={-1} className="text-xs text-gray-400 focus:outline-none">
                    {STATUS_LABEL[row.status] || row.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Uploaded by {row.preparedBy || 'a former colleague'}
                  {row.verifiedBy ? ` · checked by ${row.verifiedBy}` : ''}
                </p>
                {row.status === 'draft' ? (
                  row.preparedByYou ? (
                    <p className="mt-2 text-xs text-amber-200">You uploaded this copy, so a colleague has to check it.</p>
                  ) : !canCheck ? (
                    <p className="mt-2 text-xs text-amber-200">Confirming a registration needs the registration-check permission. Ask an admin, or a colleague who holds it.</p>
                  ) : (
                    <>
                      {row.otpVerified ? null : (
                        <p className="mt-2 text-xs text-amber-200">
                          This number was typed on the form and never confirmed by the tenant, so it cannot
                          earn a trust badge. Only a tenant who signed in with their number can be confirmed.
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {row.otpVerified ? (
                          <button type="button" disabled={!!busy} aria-label={`Confirm ${who} registered`} onClick={() => decide(row, 'registered')} className="dz-btn dz-btn-primary disabled:opacity-40">
                            <BadgeCheck className="h-4 w-4" aria-hidden="true" /> Confirm registered
                          </button>
                        ) : null}
                        <button type="button" disabled={!!busy} aria-label={`${who} is not on the copy`} onClick={() => decide(row, 'expired')} className="dz-btn dz-btn-ghost disabled:opacity-40">
                          <X className="h-4 w-4" aria-hidden="true" /> Not on the copy
                        </button>
                      </div>
                    </>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}