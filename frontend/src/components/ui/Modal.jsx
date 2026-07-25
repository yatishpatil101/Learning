import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { classNames } from '../../lib/format.js';

/**
 * Accessible modal dialog — portals to body, traps focus, closes on Escape/backdrop.
 * @param {object} props
 * @param {boolean} props.open - Whether the modal is visible.
 * @param {() => void} props.onClose - Callback to close the modal.
 * @param {string} props.title - Modal heading (also used as aria-label).
 * @param {React.ReactNode} props.children - Modal body content.
 * @param {React.ReactNode} [props.footer] - Optional footer (action buttons).
 * @param {'sm'|'md'|'lg'} [props.size='md'] - Width preset.
 */
export default function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      // When modals stack (e.g. the document viewer over a request detail),
      // only the top-most dialog should react to Escape/Tab so one keypress
      // doesn't collapse the whole stack.
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs.length && dialogs[dialogs.length - 1] !== panelRef.current) return;
      if (e.key === 'Escape') { onClose?.(); return; }
      // Focus trap: keep Tab within the modal
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = size === 'lg' ? 'max-w-2xl' : size === 'sm' ? 'max-w-sm' : 'max-w-lg';

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={classNames('pn-modal-panel relative w-full p-0 rounded-2xl border border-white/10 shadow-2xl outline-none', width)}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-5 max-h-[calc(100dvh-12rem)] overflow-y-auto">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-4 py-3 sm:px-6 sm:py-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
