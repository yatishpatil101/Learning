import Select from '../../../../../components/ui/Select.jsx';
import { DOC_TYPES, istDate } from './vocabulary.js';

const CAPTION = 'mb-1 block text-xs font-medium text-gray-400';

/* A `Select` renders a button, so a caption cannot label it: its real name is `ariaLabel`, and every
   caption must stay a substring of that name for voice control. */
export default function RecordEvidenceForm({
  id, documents, form, setForm, pending, canDecide, canRecord, needsSubject,
  onChangeDocument, onChangeDocType, onSubmit,
}) {
  return (
    <form onSubmit={onSubmit} aria-label="Record ownership evidence">
      <fieldset disabled={Boolean(pending) || !canDecide || !documents.length} className="space-y-3">
        <legend className="sr-only">Record a checked document</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <span className={CAPTION}>Uploaded document</span>
            <Select ariaLabel="Uploaded document" placeholder="Choose a file" value={form.documentId}
              disabled={!documents.length || Boolean(pending) || !canDecide} onChange={onChangeDocument}
              options={documents.map((file) => ({ value: file.id, label: `${file.fileName} — ${file.category}` }))} />
          </div>
          <div>
            <span className={CAPTION}>Document type</span>
            <Select ariaLabel="Evidence document type" placeholder="Choose type" value={form.docType}
              disabled={Boolean(pending) || !canDecide} options={DOC_TYPES} onChange={onChangeDocType} />
          </div>
          <div>
            <label htmlFor={`${id}-date`} className={CAPTION}>Document issue date</label>
            <input id={`${id}-date`} type="date" required value={form.issueDate} max={istDate()}
              aria-describedby={`${id}-date-help`} className="dz-input"
              onChange={(event) => setForm((previous) => ({ ...previous, issueDate: event.target.value }))} />
          </div>
        </div>
        {needsSubject && (
          <div>
            <label htmlFor={`${id}-subject`} className={CAPTION}>Principal name on Power of Attorney</label>
            <input id={`${id}-subject`} required maxLength={120} autoComplete="off" value={form.subjectName}
              className="dz-input" placeholder="Owner/principal named in the registered POA"
              onChange={(event) => setForm((previous) => ({ ...previous, subjectName: event.target.value }))} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="submit" disabled={Boolean(pending) || !canRecord} className="dz-btn dz-btn-primary">{pending === 'record' ? 'Recording evidence…' : 'Record evidence'}</button>
          <p id={`${id}-date-help`} className="text-xs text-gray-500">Use the date printed on the document, never today or the upload date. Recording does not grant the badge.</p>
        </div>
      </fieldset>
    </form>
  );
}
