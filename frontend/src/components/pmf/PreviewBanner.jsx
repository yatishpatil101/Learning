import { useState } from 'react';
import Icon from '../Icon.jsx';
import { pmfEnabled } from '../../lib/pmf.js';

// One-line honest "early preview" banner for the PMF test build. Renders only
// when VITE_PMF_MODE=on, so it never appears in normal dev/prod builds.
export default function PreviewBanner() {
  const [show, setShow] = useState(true);
  if (!pmfEnabled || !show) return null;
  return (
    <div className="relative z-[60] bg-gradient-to-r from-brand-teal-1 to-brand-indigo-4 text-white text-center text-xs sm:text-sm px-4 py-2 flex items-center justify-center gap-2">
      <Icon name="sparkles" className="w-4 h-4 flex-shrink-0 text-amber-200" />
      <span>
        Early preview — sample listings, not live inventory yet. We&apos;d love your feedback.
      </span>
      <button
        onClick={() => setShow(false)}
        aria-label="Dismiss preview notice"
        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100"
      >
        <Icon name="x" className="w-4 h-4" />
      </button>
    </div>
  );
}
