import { useState } from 'react';
import { BadgeCheck, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext.jsx';
import { hasPermission } from '../../../lib/adminModules.js';
import { confirmServiceRequestPoliceIntimation } from '../../../services/serviceRequestService.js';

export default function PoliceIntimation({ request, onUpdated, onError }) {
  const { user } = useAuth();
  const canWrite = hasPermission(user, 'services:write');
  const existing = request.policeIntimation || {};
  const [reference, setReference] = useState(existing.reference || '');
  const [submittedOn, setSubmittedOn] = useState(existing.submittedOn || '');
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      onUpdated(await confirmServiceRequestPoliceIntimation(request.id, { reference, submittedOn }));
    } catch (err) {
      onError(err?.message || 'Police intimation could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 p-4" aria-labelledby={`police-intimation-${request.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 id={`police-intimation-${request.id}`} className="text-sm font-semibold">Police intimation</h4>
          <p className="mt-1 text-xs text-gray-400">
            Draazy does not file tenant information with the police. Record this only after the owner
            confirms they submitted it to the relevant commissionerate.
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${existing.confirmed ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/15 text-amber-200'}`}>
          {existing.confirmed ? <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
          {existing.confirmed ? 'Confirmed' : 'Pending'}
        </span>
      </div>
      {existing.confirmed ? (
        <p className="mt-3 text-xs text-gray-400">
          Confirmed{existing.confirmedBy ? ` by ${existing.confirmedBy}` : ''}
          {existing.reference ? ` · Ref ${existing.reference}` : ''}
          {existing.submittedOn ? ` · Submitted ${existing.submittedOn}` : ''}
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-gray-400">
          Reference / acknowledgement no.
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={80}
            className="mt-1 field w-full rounded-xl px-3 py-2 text-sm text-white"
            placeholder="Optional"
          />
        </label>
        <label className="text-xs text-gray-400">
          Submission date
          <input
            type="date"
            value={submittedOn}
            onChange={(e) => setSubmittedOn(e.target.value)}
            className="mt-1 field w-full rounded-xl px-3 py-2 text-sm text-white"
          />
        </label>
      </div>
      {canWrite ? (
        <button type="button" disabled={busy} onClick={confirm} className="dz-btn dz-btn-primary mt-3 disabled:opacity-50">
          <BadgeCheck className="h-4 w-4" aria-hidden="true" /> Owner confirmed they submitted it
        </button>
      ) : (
        <p className="mt-3 text-xs text-amber-200">Recording this needs the services-write permission.</p>
      )}
    </section>
  );
}
