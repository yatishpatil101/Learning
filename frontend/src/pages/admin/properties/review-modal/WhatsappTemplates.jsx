import { MessageCircle } from 'lucide-react';
import { classNames } from '../../../../lib/format.js';

/**
 * The WhatsApp chaser picker. Presentational: it renders the library, previews one, and asks the
 * parent to send. It takes the rendered `waPreviewText` rather than a substitution function, so
 * there is no route by which a copy of the interpolation rule can grow back down here.
 */
export default function WhatsappTemplates({ review, waOpen, setWaOpen, waTemplates, waPreview, setWaPreview, waPreviewText, busy, handleSendWaTemplate }) {
  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
      <button onClick={() => { setWaOpen(!waOpen); setWaPreview(null); }} className="w-full flex items-center justify-between text-sm font-bold text-gray-200">
        <span className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-400" /> WhatsApp templates</span>
        <span className="text-xs text-gray-500">{waOpen ? 'Close' : 'Send a template'}</span>
      </button>
      {waOpen && (
        <div className="mt-3 space-y-2">
          {/* The library is fetched, so it can legitimately be empty -- an account without the
              permission, or a server that did not answer. Say so here, where somebody is looking
              for the templates, rather than as a toast when the modal opens. */}
          {waTemplates.length === 0 ? (
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
            <div className="mt-3 rounded-xl border border-emerald-500/20 bg-ink p-4">
              <div className="text-xs font-semibold text-emerald-300 mb-2">Preview {'\u2014'} {waPreview.name}</div>
              <div data-testid="wa-preview-body" className="whitespace-pre-wrap text-sm text-gray-300 bg-white/5 rounded-lg p-3 border border-white/10 max-h-48 overflow-y-auto">
                {waPreviewText}
              </div>
              <div className="mt-3 flex items-center justify-between">
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
