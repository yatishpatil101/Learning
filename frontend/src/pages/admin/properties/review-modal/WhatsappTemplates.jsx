import { MessageCircle } from 'lucide-react';
import { classNames } from '../../../../lib/format.js';

/** Takes rendered preview text so interpolation rules do not grow a second copy in this component. */
export default function WhatsappTemplates({ review, waOpen, setWaOpen, waTemplates, waPreview, setWaPreview, waPreviewText, busy, handleSendWaTemplate }) {
  return (
    <div className="px-4 py-3">
      <button type="button" aria-expanded={waOpen} onClick={() => { setWaOpen(!waOpen); setWaPreview(null); }} className="flex w-full items-center justify-between text-sm font-semibold text-gray-200">
        <span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-400" /> WhatsApp templates</span>
        <span className="text-xs font-medium text-teal-300">{waOpen ? 'Close' : 'Send a template'}</span>
      </button>
      {waOpen && (
        <div className="mt-3 space-y-2">
          {waTemplates.length === 0 ? (
            /* The library is fetched per account, so an empty list is a real state. */
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-gray-500">
              No WhatsApp templates available.
            </div>
          ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {waTemplates.map((tpl) => (
              <button key={tpl.id} onClick={() => setWaPreview(waPreview?.id === tpl.id ? null : tpl)} className={classNames('text-left rounded-xl border p-3 transition-all text-sm', waPreview?.id === tpl.id ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10 bg-white/[0.02] hover:border-white/20')}>
                <div className="font-semibold text-gray-200">{tpl.name}</div>
                <div className="text-[11px] text-gray-500 mt-0.5 capitalize">{tpl.category}</div>
              </button>
            ))}
          </div>
          )}
          {waPreview && (
            <div className="mt-3 rounded-xl border border-emerald-500/20 bg-black/20 p-3">
              <div className="text-xs font-semibold text-emerald-300 mb-2">Preview {'\u2014'} {waPreview.name}</div>
              <div data-testid="wa-preview-body" className="whitespace-pre-wrap text-sm text-gray-300 bg-white/5 rounded-lg p-3 border border-white/10 max-h-48 overflow-y-auto">
                {waPreviewText}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-gray-500">Will open WhatsApp with pre-filled message to +91 {review.ownerMobile}</span>
                <button onClick={handleSendWaTemplate} disabled={busy} className="dz-btn dz-btn-primary inline-flex items-center gap-2 disabled:opacity-50">
                  <MessageCircle className="h-4 w-4" /> Send via WhatsApp
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
