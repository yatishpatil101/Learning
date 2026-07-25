import { useEffect, useRef, useState } from 'react';
import { Check, Plus, Sparkles, X } from 'lucide-react';
import { classNames } from '../../lib/format.js';

/**
 * Tile grid for "pick all that apply" feature lists (furniture, amenities) that
 * also lets the user add their own entries when ours don't cover their property.
 *
 * Selected labels are held as a plain string array by the parent, so custom
 * entries flow through the existing state/submit path with no schema change.
 * Predefined tiles render exactly as before; custom entries render as checked
 * tiles with an ✕ badge to remove.
 *
 * @param {object} props
 * @param {Array<{label: string, Icon: React.ComponentType}>} props.options - Predefined choices.
 * @param {string[]} props.values - Currently selected labels.
 * @param {(label: string) => void} props.onToggle - Toggles a label in the array.
 * @param {string} [props.placeholder='Add your own…'] - Placeholder for the add input.
 * @param {string} [props.addAriaLabel='feature'] - Noun used in the input's aria-label.
 */
export default function FeatureSelector({
  options,
  values,
  onToggle,
  placeholder = 'Add your own…',
  addAriaLabel = 'feature',
}) {
  const [draft, setDraft] = useState('');
  // A short-lived confirmation so a commit always visibly "does something" —
  // otherwise typing a name that's already selected (or a predefined tile that
  // has scrolled out of view) just clears the box and reads as "nothing happened".
  const [status, setStatus] = useState(null); // { text, tone: 'ok' | 'muted' }
  const inputRef = useRef(null);
  const statusTimer = useRef(null);

  useEffect(() => () => clearTimeout(statusTimer.current), []);

  const flashStatus = (text, tone) => {
    setStatus({ text, tone });
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 2600);
  };

  const knownLower = options.map((o) => o.label.toLowerCase());
  const customValues = values.filter((v) => !knownLower.includes(v.toLowerCase()));

  const commit = () => {
    const label = draft.trim().replace(/\s+/g, ' ');
    if (!label) return;
    // Typing a name we already offer just selects that predefined tile.
    const match = options.find((o) => o.label.toLowerCase() === label.toLowerCase());
    const target = match ? match.label : label;
    const alreadySelected = values.some((v) => v.toLowerCase() === target.toLowerCase());
    if (alreadySelected) {
      flashStatus(`“${target}” is already in your list`, 'muted');
    } else {
      onToggle(target);
      flashStatus(`Added “${target}”`, 'ok');
    }
    setDraft('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  };

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        {options.map(({ label, Icon }) => {
          const on = values.includes(label);
          return (
            <div
              key={label}
              onClick={() => onToggle(label)}
              className={classNames('furn-tile', on && 'checked')}
            >
              <span className="furn-check"><Check className="w-3 h-3" /></span>
              <span className="furn-icon"><Icon className="w-5 h-5" /></span>
              <span className="furn-label">{label}</span>
            </div>
          );
        })}
        {customValues.map((label) => (
          <div
            key={label}
            onClick={() => onToggle(label)}
            className="furn-tile checked"
            title={`Remove ${label}`}
            data-custom="true"
          >
            <span className="furn-check"><X className="w-3 h-3" /></span>
            <span className="furn-icon"><Sparkles className="w-5 h-5" /></span>
            <span className="furn-label">{label}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 max-w-md">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={`Add a custom ${addAriaLabel}`}
          maxLength={40}
          className="form-input flex-1 px-4 py-3 rounded-xl text-white text-sm"
        />
        <button
          type="button"
          onClick={commit}
          disabled={!draft.trim()}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-semibold text-teal-300 border border-teal-500/40 hover:bg-teal-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>

      {status ? (
        <p
          aria-live="polite"
          className={classNames(
            'mt-2 text-xs font-medium',
            status.tone === 'ok' ? 'text-teal-300' : 'text-gray-400',
          )}
        >
          {status.text}
        </p>
      ) : null}
    </div>
  );
}
