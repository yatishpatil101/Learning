import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Block } from '../board.jsx';
import LocalitySelect from '../../../../components/ui/LocalitySelect.jsx';

const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}/.test(v || '') ? v.slice(0, 10) : '');

/** `null` hides a field the kind does not have. */
function initialOf({ room, group, post }) {
  if (room) return { title: room.title, note: room.note, rent: room.budget ?? '', deposit: room.deposit ?? '', localities: [room.locality].filter(Boolean), moveIn: isoDate(room.availableFrom) };
  if (group) {
    return {
      title: group.title,
      note: group.note,
      rent: group.rent ?? '',
      deposit: group.hunting ? null : group.deposit ?? '',
      localities: group.localities,
      moveIn: group.hunting ? isoDate(group.preferences?.moveInBy) : null,
    };
  }
  return { title: post.title, note: post.note, rent: post.budget ?? '', deposit: null, localities: post.localities, moveIn: isoDate(post.moveIn) };
}

const wholeAtLeast = (v, min) => String(v).trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= min;

function problemOf(form) {
  if (!wholeAtLeast(form.rent, 1)) return 'Enter the rent as a whole number of rupees.';
  if (form.deposit !== null && !wholeAtLeast(form.deposit, 0)) return 'Enter the deposit as a whole number of rupees.';
  return form.localities.length ? '' : 'Add at least one locality.';
}

function changesOf(form, initial) {
  const changed = (k) => form[k] !== null && String(form[k]).trim() !== String(initial[k] ?? '').trim();
  return Object.fromEntries([
    changed('title') && ['title', form.title.trim()],
    changed('note') && ['note', form.note.trim()],
    changed('rent') && ['rent', Number(form.rent)],
    changed('deposit') && ['deposit', Number(form.deposit)],
    changed('localities') && ['localities', form.localities],
    changed('moveIn') && form.moveIn && ['moveIn', form.moveIn],
  ].filter(Boolean));
}

function Input({ label, ...props }) {
  return (
    <label className="block text-xs text-gray-300">
      {label}
      <input {...props} className="dz-input mt-1 w-full" />
    </label>
  );
}

export default function EditDetails({ detail, busy, onSave, onCancel }) {
  const [initial] = useState(() => initialOf(detail));
  const [form, setForm] = useState(initial);
  const [picking, setPicking] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const singleLocality = Boolean(detail.room || (detail.group && !detail.group.hunting));
  const problem = problemOf(form);

  return (
    <Block icon={Pencil} title="Edit details">
      <div className="grid gap-3 sm:grid-cols-2" data-testid="flatmate-edit-form">
        <div className="sm:col-span-2"><Input label="Headline" value={form.title} onChange={set('title')} maxLength={120} /></div>
        <label className="block text-xs text-gray-300 sm:col-span-2">
          Description
          <textarea value={form.note} onChange={set('note')} maxLength={600} rows={3} className="dz-input mt-1 w-full" />
        </label>
        <Input label={detail.post ? 'Budget (₹/month)' : 'Rent (₹/month)'} type="number" min="1" step="1" value={form.rent} onChange={set('rent')} />
        {form.deposit !== null ? <Input label="Deposit (₹)" type="number" min="0" step="1" value={form.deposit} onChange={set('deposit')} /> : null}
        <div className="text-xs text-gray-300">
          {singleLocality ? 'Locality' : 'Localities'}
          <div className="mt-1">
            {singleLocality
              ? <LocalitySelect value={form.localities[0] || ''} onChange={(v) => setForm({ ...form, localities: v ? [v] : [] })} placeholder="Select locality" ariaLabel="Locality" onBusyChange={setPicking} />
              : <LocalitySelect multi values={form.localities} onChange={(arr) => setForm({ ...form, localities: arr })} placeholder="Add localities" ariaLabel="Localities" onBusyChange={setPicking} />}
          </div>
        </div>
        {form.moveIn !== null ? <Input label={detail.room ? 'Available from' : 'Move-in by'} type="date" value={form.moveIn} onChange={set('moveIn')} /> : null}
      </div>
      {problem ? <p className="mt-2 text-xs text-amber-300" role="alert">{problem}</p> : null}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy || picking || Boolean(problem)} onClick={() => onSave(changesOf(form, initial))} className="dz-btn dz-btn-primary disabled:opacity-40">{busy ? 'Saving…' : 'Save changes'}</button>
        <button type="button" disabled={busy} onClick={onCancel} className="dz-btn dz-btn-ghost">Cancel</button>
      </div>
    </Block>
  );
}
