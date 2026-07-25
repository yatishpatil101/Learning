import { classNames } from '../../lib/format.js';

/**
 * Accessible toggle switch (role="switch").
 * @param {object} props
 * @param {boolean} props.checked - Whether the switch is on.
 * @param {(checked: boolean) => void} props.onChange - Callback with new state.
 * @param {string} [props.label] - Accessible label (aria-label).
 * @param {boolean} [props.disabled] - Disable interaction.
 * @param {string} [props.id] - ID for label association.
 * @param {string} [props.name] - Name for form submission.
 */
export default function Switch({ checked, onChange, label, disabled, id, name }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      name={name}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={classNames(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50',
        checked ? 'bg-brand-teal' : 'bg-white/15',
      )}
    >
      <span
        className={classNames(
          'inline-block h-5 w-5 transform rounded-full bg-white transition',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
