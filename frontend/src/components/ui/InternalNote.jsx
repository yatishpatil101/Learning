import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, MessageSquareText } from 'lucide-react';
import { addInternalNote, getInternalNotes } from '../../lib/mockApi.js';
import { classNames } from '../../lib/format.js';

/**
 * Inline "Internal note (optional)" input for maker-checker actions.
 * - Compact by default: single-line label that expands on click.
 * - Optionally shows note history for the entity.
 *
 * @param {object} props
 * @param {string} props.entityType - e.g. 'listing', 'user', 'review', 'report'
 * @param {string} props.entityId - the record ID
 * @param {string} props.value - controlled textarea value
 * @param {(v: string) => void} props.onChange - controlled setter
 * @param {boolean} [props.showHistory=false] - show past notes
 * @param {string} [props.className] - wrapper class
 */
export default function InternalNote({ entityType, entityId, value, onChange, showHistory = false, className }) {
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const notes = useMemo(
    () => (showHistory ? getInternalNotes(entityType, entityId) : []),
    [showHistory, entityType, entityId]
  );

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
      {showHistory && notes.length > 0 && (
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
                    <span className="font-medium text-gray-300">{n.by}</span>
                    {n.action && <span className="rounded bg-white/5 px-1 py-0.5 text-[10px]">{n.action}</span>}
                    <span>{new Date(n.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
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

// Re-export for convenience — callers import { submitNote } from this file
export { addInternalNote as submitNote };
