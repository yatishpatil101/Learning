import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, MessageSquareText } from 'lucide-react';
import { addNote, listNotes } from '../../services/noteService.js';
import { classNames } from '../../lib/format.js';

/**
 * Inline "Internal note (optional)" input for maker-checker actions.
 * - Compact by default: single-line label that expands on click.
 * - Optionally shows note history for the entity.
 *
 * ## The history used to be a lie (D29)
 *
 * This read was a synchronous `useMemo` over `getInternalNotes(...)`, a localStorage bucket that
 * only this browser ever wrote. Two members of staff working the same queue each saw their own
 * notes and none of each other's, and neither had any way to tell — an empty history and a history
 * nobody else could see render identically. It now reads `noteService`, so in live mode the history
 * is the team's.
 *
 * The count in the toggle is deliberately withheld until the read lands rather than starting at 0
 * and jumping. "0 previous notes" is a claim about the case; "nothing yet" while loading is the
 * honest version of not knowing, and this widget's whole failure mode was confidently saying
 * nothing was there.
 *
 * @param {object} props
 * @param {string} props.entityType - 'listing' | 'user' | 'review' | 'report'
 * @param {string} props.entityId - the record ID
 * @param {string} props.value - controlled textarea value
 * @param {(v: string) => void} props.onChange - controlled setter
 * @param {boolean} [props.showHistory=false] - show past notes
 * @param {string} [props.className] - wrapper class
 */
export default function InternalNote({ entityType, entityId, value, onChange, showHistory = false, className }) {
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notes, setNotes] = useState(null);

  useEffect(() => {
    if (!showHistory || !entityType || !entityId) {
      setNotes(null);
      return undefined;
    }
    let alive = true;
    setNotes(null);
    listNotes(entityType, entityId)
      .then((rows) => { if (alive) setNotes(rows); })
      // A history that cannot be read is not a case with no history. Staying at null keeps the
      // toggle hidden rather than asserting a count this component does not have.
      .catch(() => { if (alive) setNotes(null); });
    return () => { alive = false; };
  }, [showHistory, entityType, entityId]);

  return (
    <div className={classNames('mt-3', className)}>
      {/* Toggle label */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition"
      >
        <MessageSquareText className="h-3.5 w-3.5" />
        <span>Internal note (optional)</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {/* Textarea */}
      {expanded && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          placeholder="Add a note for the team... (visible only to admins/staff)"
          className="mt-2 pn-input resize-none text-sm"
        />
      )}

      {/* Note history */}
      {showHistory && notes?.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(!historyOpen)}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 transition"
          >
            <span>{notes.length} previous note{notes.length > 1 ? 's' : ''}</span>
            {historyOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {historyOpen && (
            <div className="mt-1.5 max-h-40 overflow-y-auto space-y-1.5 rounded-lg border border-white/5 bg-white/[0.02] p-2">
              {notes.map((n) => (
                <div key={n.id} className="text-[11px] leading-relaxed">
                  <div className="flex items-center gap-1.5 text-gray-500">
                    <span className="font-medium text-gray-300">{n.author}</span>
                    {n.action && <span className="rounded bg-white/5 px-1 py-0.5 text-[10px]">{n.action}</span>}
                    {n.at && <span>{new Date(n.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</span>}
                    {n.editedAt && <span className="text-[10px] italic">edited</span>}
                  </div>
                  <p className="mt-0.5 text-gray-400">{n.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The write half, re-exported so a caller that renders the textarea can also submit it.
 *
 * Now async, and now rejects rather than returning null on a blank note. Callers guard on the text
 * being non-empty before calling — the label says "optional", and an action taken without a note is
 * the ordinary case, not a failure.
 *
 * @param {'listing'|'user'|'review'|'report'} entityType
 * @param {string} entityId
 * @param {string} text
 * @param {string} [action] the decision this note was filed beside
 * @returns {Promise<object>} the stored note
 */
export { addNote as submitNote };

/**
 * Save the note beside a decision, if the moderator wrote one.
 *
 * Every caller of this is in the same position: a decision has *already* landed on the server and
 * the note is the second write. That rules out both of the obvious ways to handle a failure. Letting
 * it throw puts the rejection in the same `catch` as the decision, so the screen says "could not
 * approve this listing" about a listing that is now approved and published — the worst available
 * lie. Swallowing it silently is the bug this whole item exists to fix.
 *
 * So it reports instead: the caller gets back whether anything was written and what went wrong, and
 * says so in the toast it was already showing. The moderator finds out while they still have the
 * words in front of them.
 *
 * @param {'listing'|'user'|'review'|'report'} entityType
 * @param {string} entityId
 * @param {string} text the textarea's contents; blank means the moderator chose not to note
 *   anything, which is the ordinary case and not a failure
 * @param {string} [action] the decision this note was filed beside
 * @returns {Promise<{written: boolean, error: Error|null}>}
 */
export async function saveNoteIfAny(entityType, entityId, text, action) {
  const clean = String(text ?? '').trim();
  if (!clean) return { written: false, error: null };
  try {
    await addNote(entityType, entityId, clean, action);
    return { written: true, error: null };
  } catch (error) {
    return { written: false, error };
  }
}


