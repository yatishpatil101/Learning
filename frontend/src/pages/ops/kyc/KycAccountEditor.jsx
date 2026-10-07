import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useToast } from '../../../context/ToastContext.jsx';
import { updateKycProfile } from '../../../services/identityReviewService.js';
import { Field } from './KycActionRail.jsx';

export default function KycAccountEditor({ detail, canWrite, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  if (!form) {
    return (
      <div data-testid="ops-identity-account" className="mt-3 space-y-2">
        <dl className="space-y-2">
          <Field label="Account name" value={detail.accountName || '—'} />
          <Field label="Account email" value={detail.accountEmail || '—'} />
        </dl>
        {canWrite && detail.userId ? (
          <button type="button" onClick={() => setForm({ name: detail.accountName || '', email: detail.accountEmail || '' })} className="dz-btn dz-btn-ghost">
            <Pencil className="h-4 w-4" /> Edit account
          </button>
        ) : null}
      </div>
    );
  }

  const name = form.name.trim();
  const email = form.email.trim();
  const save = async () => {
    if (!name) { toast('Account name is required', 'error'); return; }
    const changes = {
      name: name !== (detail.accountName || '') ? name : undefined,
      email: email !== (detail.accountEmail || '') ? email : undefined,
    };
    if (!changes.name && !changes.email) { setForm(null); return; }
    setSaving(true);
    try {
      await updateKycProfile(detail.userId, changes);
      await onSaved();
      toast('Account details updated', 'success');
      setForm(null);
    } catch (err) {
      toast(err?.message || 'Could not update the account', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="ops-identity-account" className="mt-3 space-y-2">
      <label className="block text-xs text-gray-300">
        Account name
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} className="dz-input mt-1 w-full" />
      </label>
      <label className="block text-xs text-gray-300">
        Account email
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="dz-input mt-1 w-full" />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving} className="dz-btn dz-btn-primary disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={() => setForm(null)} disabled={saving} className="dz-btn dz-btn-ghost">Cancel</button>
      </div>
    </div>
  );
}
