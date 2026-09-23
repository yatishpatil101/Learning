import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { classNames } from '../../lib/format.js';
import useModalDialog from '../../hooks/useModalDialog.js';
import useSwipeDismiss from '../../lib/useSwipeDismiss.js';
import useScrollLock from '../../hooks/useScrollLock.js';

/* Accessible modal dialog — portals to body, traps focus, closes on Escape/backdrop. */
export default function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  /* Gives the grab handle that `.dz-modal-sheet::before` draws an actual behaviour. */
  const swipe = useSwipeDismiss(onClose);

  useScrollLock(open);
  const panelRef = useModalDialog(open, onClose);

  if (!open) return null;

  const width = size === 'lg' ? 'max-w-2xl' : size === 'sm' ? 'max-w-sm' : 'max-w-lg';

  // Below 640px the dialog docks as a bottom sheet, and `z-[1550]` places it in the app's
  // floating-chrome band — see docs/system/design-system.md § Bottom sheets.
  return createPortal(
    <div className="fixed inset-0 z-[1550] flex items-end justify-center p-0 sm:items-center sm:justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} />
      {/* Escape and the close button remain the accessible ways out; the drag is additive. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        {...swipe}
        className={classNames(
          'dz-modal-panel dz-modal-sheet relative w-full p-0 border border-white/10 shadow-2xl outline-none',
          'flex max-h-[88dvh] flex-col rounded-t-2xl',
          'sm:block sm:max-h-none sm:rounded-2xl',
          width,
        )}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <button onClick={onClose} aria-label={title ? `Close ${title}` : 'Close'} className="tap-target -mr-2 inline-flex items-center justify-center rounded-lg text-gray-400 hover:bg-white/10 hover:text-white transition sm:mr-0 sm:min-h-0 sm:min-w-0 sm:p-1.5">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:flex-none sm:px-6 sm:py-5 sm:max-h-[calc(100dvh-12rem)]">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-4 py-3 pb-[calc(0.75rem+var(--dz-safe-b))] sm:px-6 sm:py-4 sm:pb-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
