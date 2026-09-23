import { useEffect, useRef, useState } from 'react';
import { Check, Plus, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { classNames } from '../../lib/format.js';
import { onActivateKey } from '../../lib/onActivateKey.js';

/** Custom entries are held in the same plain string array as the predefined ones, so they flow
 *  through the existing state/submit path with no schema change. */
export default function FeatureSelector({
  options,
  values,
  onToggle,
  placeholder,
  addAriaLabel,
}) {
  const { t } = useTranslation();
  const ph = placeholder || t('ui.addYourOwn');
  const noun = addAriaLabel || t('ui.featureNoun');
  const [draft, setDraft] = useState('');
  // A short-lived confirmation so a commit always visibly "does something": re-adding an entry
  // already in the list would otherwise just clear the box and read as nothing happening.
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
              onKeyDown={onActivateKey(() => onToggle(label))}
              // The app-wide :active press response selects on roles, never on tag names,
              // so without this the grid stays inert under a finger.
              role="button"
              tabIndex={0}
              aria-pressed={on}
              className={classNames('furn-tile', on && 'checked')}
            >
              <span className="furn-check"><Check className="w-3 h-3" /></span>
              <span className="furn-icon"><Icon className="w-5 h-5" /></span>
              <span className="furn-label">{label}</span>
            </div>
          );
        })}
        {customValues.map((label) => {
          // aria-label overrides title for a screen reader but not for the mouse tooltip,
          // so both are needed and must not drift.
          const removeLabel = `Remove ${label}`;
          return (
            <div
              key={label}
              onClick={() => onToggle(label)}
              onKeyDown={onActivateKey(() => onToggle(label))}
              role="button"
              tabIndex={0}
              aria-label={removeLabel}
              className="furn-tile checked"
              title={removeLabel}
              data-custom="true"
            >
              <span className="furn-check"><X className="w-3 h-3" /></span>
              <span className="furn-icon"><Sparkles className="w-5 h-5" /></span>
              <span className="furn-label">{label}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2 max-w-md">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={ph}
          aria-label={t('ui.addCustom', { noun })}
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
