import { useState } from 'react';
import { classNames } from '../../lib/format.js';
import HScroll from './HScroll.jsx';
import Icon from '../Icon.jsx';

/* Tabs: items [{ key, label, icon?, content }].
   Controlled: pass `active` + `onChange`.
   Uncontrolled: pass `initial` (defaults to first item).
   variant: 'pill' (default segmented look) | 'underline' (property-detail style). */
export default function Tabs({ items, initial, active: controlledActive, onChange, variant = 'pill' }) {
  const [internalActive, setInternalActive] = useState(initial ?? items[0]?.key);
  const active = controlledActive ?? internalActive;
  const current = items.find((i) => i.key === active) ?? items[0];

  const select = (key) => {
    if (!controlledActive) setInternalActive(key);
    onChange?.(key);
  };

  if (variant === 'underline') {
    return (
      <div>
        <HScroll role="tablist" fadeColor="var(--brand-bg, #0e0c1a)" className="flex gap-1 sm:gap-2 border-b border-white/10">
          {items.map((i) => (
            <button
              key={i.key}
              type="button"
              role="tab"
              aria-selected={active === i.key}
              onClick={() => select(i.key)}
              className={classNames('dz-detail-tab', active === i.key ? 'is-active' : '')}
            >
              {i.icon ? <Icon name={i.icon} className="w-4 h-4" /> : null}
              <span>{i.label}</span>
            </button>
          ))}
        </HScroll>
        <div role="tabpanel" className="mt-6">
          {current?.content}
        </div>
      </div>
    );
  }

  /* A segmented control is a "pick one of these" decision, so every option has to
     be visible to be weighed. Past three pills that stops being true on a 360px
     phone — the rest sit off-screen behind a scroll nobody knows to perform — so
     below `sm` the strip wraps into a 2-up grid instead. The HScroll wrapper stays
     (desktop is unchanged) and its edge fades switch themselves off once there is
     nothing left to scroll. */
  const wrapOnMobile = items.length > 3;

  return (
    <div>
      <HScroll
        role="tablist"
        fadeColor="var(--brand-card, #1a1730)"
        className={classNames(
          'flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1',
          wrapOnMobile && 'max-sm:grid max-sm:grid-cols-2 max-sm:overflow-x-visible',
        )}
      >
        {items.map((i) => (
          <button
            key={i.key}
            role="tab"
            aria-selected={active === i.key}
            onClick={() => select(i.key)}
            className={classNames(
              'flex-1 shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition',
              // 44px touch floor on mobile; desktop keeps the original density.
              'min-h-[44px] sm:min-h-0',
              wrapOnMobile ? 'whitespace-normal sm:whitespace-nowrap' : 'whitespace-nowrap',
              active === i.key ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:text-white',
            )}
          >
            {i.label}
          </button>
        ))}
      </HScroll>
      <div role="tabpanel" className="mt-4">
        {current?.content}
      </div>
    </div>
  );
}
