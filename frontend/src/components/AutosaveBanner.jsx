import Icon from './Icon.jsx';

/* "We restored your unsaved draft" banner — matches the prototype's autosave.js
   restore banner. Render at the top of a form when `restored` is true. */
export default function AutosaveBanner({ restored, onStartFresh, className = '' }) {
  if (!restored) return null;
  return (
    <div className={'mb-4 flex items-center gap-3 rounded-2xl border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-100 ' + className}>
      <Icon name="rotate-ccw" className="w-4 h-4 flex-shrink-0 text-teal-300" />
      <span className="flex-1">We restored your unsaved draft — pick up where you left off.</span>
      <button
        type="button"
        onClick={onStartFresh}
        className="whitespace-nowrap rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-white/5"
      >
        Start fresh
      </button>
    </div>
  );
}
