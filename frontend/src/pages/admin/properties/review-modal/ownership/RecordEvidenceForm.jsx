import Select from '../../../../../components/ui/Select.jsx';
import { DOC_TYPES, istDate } from './vocabulary.js';

/* A `Select` renders a button, so `htmlFor` cannot reach it: its caption is decoration and its
   real name is `ariaLabel`. Keep every caption a substring of that name, or voice control loses
   the control the reviewer can see. */
function Field({ label, htmlFor, hint, hintId, children }) {
  const Caption = htmlFor ? 'label' : 'span';
  const help = hintId || (htmlFor && `${htmlFor}-help`);
  return (
    <div>
      <Caption htmlFor={htmlFor} className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</Caption>
      {children}
      {hint ? <p id={help} className="mt-1.5 text-xs leading-relaxed text-gray-500">{hint}</p> : null}
    </div>
  );
}

/* Form state stays with the panel, which owns every rule about what a selection resets, a type
   change discards and a successful write clears. This component only draws it. */
export default function RecordEvidenceForm({
  id, documents, form, setForm, pending, canDecide, canRecord, needsSubject,
  onChangeDocument, onChangeDocType, onSubmit,
}) {
  return (
    <form onSubmit={onSubmit} aria-label="Record ownership evidence">
      <fieldset disabled={Boolean(pending) || !canDecide} className="space-y-3">
        {/* Step 3's heading already names this section on screen; a second visible one is noise. */}
        <legend className="sr-only">Record a checked document</legend>
        <Field label="Uploaded document" hintId={`${id}-doc-help`}
          hint={documents.length ? undefined : 'Nothing has been uploaded yet, so there is nothing to check.'}>
          <Select ariaLabel="Uploaded document" placeholder="Choose an uploaded document" value={form.documentId}
            ariaDescribedBy={documents.length ? undefined : `${id}-doc-help`}
            disabled={!documents.length || Boolean(pending) || !canDecide} onChange={onChangeDocument}
            options={documents.map((file) => ({ value: file.id, label: `${file.fileName} — ${file.category}` }))} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Document type">
            <Select ariaLabel="Evidence document type" placeholder="Choose the document type" value={form.docType}
              disabled={Boolean(pending) || !canDecide} options={DOC_TYPES} onChange={onChangeDocType} />
          </Field>
          <Field label="Document issue date" htmlFor={`${id}-date`}
            hint="Read the date printed on the document, or the capture date for site photos. Never substitute today or the upload date.">
            <input id={`${id}-date`} type="date" required value={form.issueDate} max={istDate()}
              aria-describedby={`${id}-date-help`} className="dz-input"
              onChange={(event) => setForm((previous) => ({ ...previous, issueDate: event.target.value }))} />
          </Field>
        </div>
        {needsSubject && (
          <Field label="Subject name on identity document" htmlFor={`${id}-subject`}
            hint="Type the name exactly as it is printed, so it can be compared with the lister above.">
            <input id={`${id}-subject`} required maxLength={120} autoComplete="off" value={form.subjectName}
              aria-describedby={`${id}-subject-help`} className="dz-input"
              onChange={(event) => setForm((previous) => ({ ...previous, subjectName: event.target.value }))} />
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/10 pt-3">
          <button type="submit" disabled={Boolean(pending) || !canRecord} className="dz-btn dz-btn-primary min-h-[44px]">{pending === 'record' ? 'Recording evidence…' : 'Record evidence'}</button>
          <p className="text-xs text-gray-400">Logs the check against this listing. It does not grant the badge.</p>
        </div>
      </fieldset>
    </form>
  );
}
