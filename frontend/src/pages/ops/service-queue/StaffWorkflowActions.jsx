import { useState } from 'react';
import { FileUp, Send } from 'lucide-react';
import DateField from '../../../components/ui/DateField.jsx';

const DRAFTABLE = new Set(['docs_review', 'draft_shared', 'changes_requested']);

const REGISTRATION_FIELDS = [
  { key: 'documentNo', label: 'Document number', placeholder: 'HVL11-4321-2026', maxLength: 40 },
  { key: 'sro', label: 'Sub-Registrar office', placeholder: 'Haveli 11', maxLength: 60 },
  { key: 'registeredOn', label: 'Registration date', type: 'date' },
  { key: 'grn', label: 'GRAS challan GRN', placeholder: 'MH0045…', maxLength: 30 },
  { key: 'stampDuty', label: 'Stamp duty paid (₹)', inputMode: 'numeric', maxLength: 11 },
  { key: 'registrationFee', label: 'Registration fee paid (₹)', inputMode: 'numeric', maxLength: 11 },
];
const EMPTY_REGISTRATION = Object.fromEntries(REGISTRATION_FIELDS.map(({ key }) => [key, '']));

// Keys must match DraftingChecklist.java; the server refuses a rent-agreement draft without all of them.
const DRAFT_CHECKS = [
  { key: 'identity', label: 'Aadhaar / PAN numbers in the draft match the uploaded scans' },
  { key: 'title', label: 'Ownership proof (index II / sale deed / tax bill) names every licensor' },
  { key: 'poa', label: 'Any power of attorney is registered and covers leave & license (or none is used)' },
  { key: 'address', label: 'Flat address in the draft matches the ownership proof' },
  { key: 'terms', label: 'Term, rent, deposit, lock-in and notice match the deed particulars' },
];

export default function StaffWorkflowActions({ request, onShareDraft, onUploadFinal }) {
  const [draftFile, setDraftFile] = useState(null);
  const [draftNote, setDraftNote] = useState('');
  const [checks, setChecks] = useState([]);
  const [finalFile, setFinalFile] = useState(null);
  const [registration, setRegistration] = useState(EMPTY_REGISTRATION);
  const [busy, setBusy] = useState('');
  const needsRecord = request.type === 'rental';
  const draftReady = !!draftFile && (!needsRecord || checks.length === DRAFT_CHECKS.length);
  const finalReady = !!finalFile && (!needsRecord || REGISTRATION_FIELDS.every(({ key }) => registration[key].trim()));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const toggleCheck = (key) => setChecks((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const share = async (event) => {
    event.preventDefault();
    if (!draftReady || busy) return;
    const form = event.currentTarget;
    setBusy('draft');
    try {
      await onShareDraft({ file: draftFile, note: draftNote, checks: needsRecord ? checks : [] });
      setDraftFile(null);
      setDraftNote('');
      setChecks([]);
      form.reset();
    } catch {
      // The desk has already toasted the server's reason; keep the file for a retry.
    } finally {
      setBusy('');
    }
  };

  const uploadFinal = async (event) => {
    event.preventDefault();
    if (!finalReady || busy) return;
    const form = event.currentTarget;
    setBusy('final');
    try {
      await onUploadFinal(finalFile, needsRecord ? registration : undefined);
      setFinalFile(null);
      setRegistration(EMPTY_REGISTRATION);
      form.reset();
    } catch {
      // As above.
    } finally {
      setBusy('');
    }
  };

  if (request.draftCheck?.status === 'pending') {
    return (
      <section className="rounded-2xl border border-white/10 p-4">
        <h4 className="text-sm font-semibold">Drafting workflow</h4>
        <p className="mt-2 text-sm text-amber-200">Waiting for a second-operator check before this draft reaches the customer.</p>
      </section>
    );
  }
  if (!DRAFTABLE.has(request.status) && request.status !== 'approved') return null;
  return (
    <section className="rounded-2xl border border-white/10 p-4" aria-labelledby="workflow-actions-title">
      <h4 id="workflow-actions-title" className="text-sm font-semibold">Drafting workflow</h4>
      {DRAFTABLE.has(request.status) ? (
        <form onSubmit={share} className="mt-3 space-y-2">
          <label className="block text-xs text-gray-400" htmlFor="service-draft-file">Draft to share with customer</label>
          <input id="service-draft-file" type="file" accept="application/pdf,image/*" onChange={(event) => setDraftFile(event.target.files?.[0] || null)} className="block w-full text-sm text-gray-300" />
          <label className="sr-only" htmlFor="service-draft-note">Draft note</label>
          <input id="service-draft-note" value={draftNote} onChange={(event) => setDraftNote(event.target.value)} maxLength={500} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" placeholder="Optional note for the customer" />
          {needsRecord ? (
            <fieldset className="space-y-1">
              <legend className="mb-1 text-xs text-gray-400">Before the customer sees it</legend>
              {DRAFT_CHECKS.map(({ key, label }) => (
                <label key={key} className="flex items-start gap-2 text-xs text-gray-300">
                  <input type="checkbox" name="checks" value={key} checked={checks.includes(key)} onChange={() => toggleCheck(key)} className="mt-0.5" />
                  {label}
                </label>
              ))}
            </fieldset>
          ) : null}
          <button type="submit" disabled={!draftReady || !!busy} className="dz-btn dz-btn-primary disabled:opacity-40"><Send className="h-4 w-4" aria-hidden="true" /> {busy === 'draft' ? 'Sharing…' : 'Share draft'}</button>
        </form>
      ) : null}
      {request.status === 'approved' ? (
        <form onSubmit={uploadFinal} className="mt-3 space-y-2">
          <label className="block text-xs text-gray-400" htmlFor="service-final-file">Registered copy</label>
          <input id="service-final-file" type="file" accept="application/pdf,image/*" onChange={(event) => setFinalFile(event.target.files?.[0] || null)} className="block w-full text-sm text-gray-300" />
          {needsRecord ? (
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-1 text-xs text-gray-400">As printed on the Sub-Registrar's endorsement and the GRAS challan</legend>
              {REGISTRATION_FIELDS.map(({ key, label, ...input }) => {
                const set = (value) => setRegistration((prev) => ({ ...prev, [key]: value }));
                const fieldClass = 'mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white';
                return (
                  <label key={key} className="block text-xs text-gray-400">
                    {label}
                    {input.type === 'date' ? (
                      <DateField value={registration[key]} max={today} onChange={set} ariaLabel={label} className={fieldClass} />
                    ) : (
                      <input
                        {...input}
                        name={key}
                        required
                        value={registration[key]}
                        onChange={(event) => set(event.target.value)}
                        className={fieldClass}
                      />
                    )}
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          <button type="submit" disabled={!finalReady || !!busy} className="dz-btn dz-btn-primary disabled:opacity-40"><FileUp className="h-4 w-4" aria-hidden="true" /> {busy === 'final' ? 'Uploading…' : 'Upload registered copy'}</button>
        </form>
      ) : null}
    </section>
  );
}
