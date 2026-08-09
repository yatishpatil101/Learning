import { useState } from 'react';
import { ShieldCheck, Star, ArrowRight } from 'lucide-react';
import AadhaarVerifyModal from '../../../components/auth/AadhaarVerifyModal.jsx';
import { useVerification } from '../../../context/VerificationContext.jsx';
import { trackKyc } from '../../../lib/kycTrack.js';

/* C1 — post-listing success nudge (badge-not-gate growth lever, ADR-019).
   Fires ONLY after a NEW property goes live — i.e. at the value moment, never before it
   (guardrail: no KYC ask precedes value). Offers the opt-in Verified badge and surfaces the
   one-time reward: verified owners rank higher and the first verified listing gets a free
   7-day Featured boost. Fully dismissible; the listing is already live regardless. */
export default function PostSuccessVerifyNudge({ t }) {
  const { verified } = useVerification();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (verified) {
    return (
      <div className="mt-6 rounded-xl border border-teal-400/30 bg-teal-500/10 px-4 py-3 flex items-center justify-center gap-2 text-teal-300 text-sm font-medium">
        <ShieldCheck className="w-4 h-4" /> {t('listProperty.verifyNudge.done')}
      </div>
    );
  }
  if (dismissed) return null;

  return (
    <>
      <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-400/15 border border-amber-400/30 flex items-center justify-center shrink-0">
            <Star className="w-4.5 h-4.5 text-amber-300" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm">{t('listProperty.verifyNudge.title')}</p>
            <p className="text-gray-400 text-xs leading-relaxed mt-1">{t('listProperty.verifyNudge.body')}</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <button
            onClick={() => { trackKyc('badge_cta_click', 'post_success'); setOpen(true); }}
            className="btn-teal inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-white font-semibold text-sm w-full sm:w-auto"
          >
            <ShieldCheck className="w-4 h-4" /> {t('listProperty.verifyNudge.cta')} <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="px-5 py-2.5 rounded-lg text-gray-400 hover:text-white text-sm font-medium w-full sm:w-auto"
          >
            {t('listProperty.verifyNudge.later')}
          </button>
        </div>
      </div>

      {open && (
        <AadhaarVerifyModal
          source="post_success"
          subtitle={t('listProperty.verifyNudge.modalSubtitle')}
          onClose={() => setOpen(false)}
          onVerified={() => setOpen(false)}
        />
      )}
    </>
  );
}
