import { useState } from 'react';
import Icon from './Icon.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { recordServiceRequestIdentities } from '../services/serviceRequestService.js';
import { digits, isAadhaar, isPan } from '../pages/consumer/services/rent-agreement/helpers.js';

const IDENTITY_EVENTS = new Set(['identities.purged', 'identities.recorded']);
const slotKey = (slot) => `${slot.role}-${slot.index}`;

export const needsIdentityRefill = (request) =>
  [...(request.timeline || [])].reverse().find((t) => IDENTITY_EVENTS.has(t.stage))?.stage === 'identities.purged';

const slotMobile = (state, { role, index }) => {
  if (role === 'owner') return index === 0 ? state.owner?.oMobile : state.coOwners?.[index - 1]?.mobile;
  return role === 'tenant' ? state.tenants?.[index]?.mobile : null;
};

export const refillSlots = (request, viewerMobile) => {
  const state = request.details?._state || {};
  const coFill = new Set((request.parties || []).filter((p) => p.status === 'accepted').map((p) => `${p.role}-${p.partyIndex}`));
  const named = [
    { role: 'owner', index: 0, name: state.owner?.oName, pan: true },
    ...(state.coOwners || []).map((c, i) => ({ role: 'owner', index: i + 1, name: c?.name, pan: true })),
    ...(state.tenants || []).map((t, i) => ({ role: 'tenant', index: i, name: t?.name, pan: true })),
    { role: 'witness', index: 0, name: state.wit?.w1Name, pan: false },
    { role: 'witness', index: 1, name: state.wit?.w2Name, pan: false },
  ].filter((slot) => String(slot.name || '').trim());
  const viewer = digits(viewerMobile);
  if (viewer && named.some((slot) => coFill.has(slotKey(slot)) && digits(slotMobile(state, slot)) === viewer)) return [];
  return named.filter((slot) => !coFill.has(slotKey(slot)));
};

const ROLE_LABEL = { owner: 'Owner', tenant: 'Tenant', witness: 'Witness' };

export default function IdentityRefill({ request, viewerMobile, onSaved }) {
  const { toast } = useToast();
  const [values, setValues] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const slots = refillSlots(request, viewerMobile);
  if (!slots.length) return null;

  const set = (slot, field, value) => setValues((prev) => ({ ...prev, [slotKey(slot)]: { ...prev[slotKey(slot)], [field]: value } }));

  const save = async () => {
    const parties = slots.map((slot) => {
      const v = values[slotKey(slot)] || {};
      return {
        partyRole: slot.role,
        partyIndex: slot.index,
        partyName: String(slot.name).trim().slice(0, 120),
        pan: slot.pan ? String(v.pan || '').trim().toUpperCase() : '',
        aadhaar: digits(v.aadhaar),
      };
    }).filter((p) => p.pan || p.aadhaar);
    if (!parties.length) { setError('Enter at least one number.'); return; }
    const bad = parties.find((p) => (p.pan && !isPan(p.pan)) || (p.aadhaar && !isAadhaar(p.aadhaar)));
    if (bad) { setError(`Check the numbers for ${bad.partyName}.`); return; }
    setError('');
    setBusy(true);
    try {
      await recordServiceRequestIdentities(request.id, parties);
      setValues({});
      toast('Identity numbers saved. Our team can continue drafting.', 'success');
      onSaved?.();
    } catch (e) {
      console.warn('[identity-refill] save failed', e?.status || e?.message);
      setError(e?.message || 'Could not save the numbers. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white outline-none focus:border-teal-400/50';
  return (
    <div data-testid="identity-refill" className="mb-3 rounded-xl border border-amber-500/25 bg-amber-500/8 p-3">
      <p className="text-sm font-semibold text-white flex items-center gap-2"><Icon name="shield-alert" className="w-4 h-4 text-amber-300" /> We deleted the identity numbers on this request</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-300">This request sat idle, so we discarded the PAN and Aadhaar numbers we held. Enter them again so our team can finish the agreement.</p>
      <ul className="mt-3 space-y-2">
        {slots.map((slot) => {
          const v = values[slotKey(slot)] || {};
          return (
            <li key={slotKey(slot)} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr] sm:items-center">
              <span className="text-xs text-gray-200">{slot.name} <span className="text-gray-500">· {ROLE_LABEL[slot.role]}</span></span>
              {slot.pan ? (
                <input value={v.pan || ''} onChange={(e) => set(slot, 'pan', e.target.value.slice(0, 10))} aria-label={`PAN of ${slot.name}`} placeholder="PAN" autoComplete="off" className={input} />
              ) : <span className="hidden sm:block" />}
              <input value={v.aadhaar || ''} onChange={(e) => set(slot, 'aadhaar', e.target.value.replace(/[^\d ]/g, '').slice(0, 14))} aria-label={`Aadhaar of ${slot.name}`} placeholder="Aadhaar" inputMode="numeric" autoComplete="off" className={input} />
            </li>
          );
        })}
      </ul>
      {error ? <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p> : null}
      <button type="button" onClick={save} disabled={busy} className="btn-teal mt-3 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save numbers'}</button>
    </div>
  );
}
