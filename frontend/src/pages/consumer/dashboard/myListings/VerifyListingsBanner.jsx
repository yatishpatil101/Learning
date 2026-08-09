import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Star, X } from 'lucide-react';
import AadhaarVerifyModal from '../../../../components/auth/AadhaarVerifyModal.jsx';
import { useVerification } from '../../../../context/VerificationContext.jsx';
import { trackKyc } from '../../../../lib/kycTrack.js';

/* A1 — panel-level verify banner on My Listings (badge-not-gate growth lever, ADR-019).
   One badge lifts ALL of an owner's listings, so this is a single panel banner (not per-card
   noise). Shown only to an owner who already has listings but hasn't earned the badge — the
   value (live listings) already exists, so this is a nudge at a value moment, never a gate.
   Dismissible for the session. On success it refreshes the panel so cards reflect the badge
   and the first-verify Featured boost. */
export default function VerifyListingsBanner({ onVerified, enquiryCount = 0 }) {
  const { t } = useTranslation();
  const { verified } = useVerification();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (verified || dismissed) return null;

  // C2: when the owner already has enquiries, lead with that value moment.
  const hasLeads = enquiryCount > 0;
  const headline = hasLeads
    ? t('verify.bannerHeadlineLeads', { count: enquiryCount })
    : t('verify.bannerHeadline');

  return (
    <>
      <div className="mb-5 rounded-xl border border-amber-400/25 bg-gradient-to-r from-amber-400/[0.08] to-teal-400/[0.06] p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-400/15 border border-amber-400/30 flex items-center justify-center shrink-0">
          <Star className="w-4.5 h-4.5 text-amber-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white font-semibold text-sm">{headline}</p>
          <p className="text-gray-400 text-xs leading-relaxed mt-0.5">
            {t('verify.bannerBody')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { trackKyc('badge_cta_click', 'my_listings'); setOpen(true); }}
            className="btn-teal inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-white font-semibold text-sm whitespace-nowrap"
          >
            <ShieldCheck className="w-4 h-4" /> {t('verify.bannerCta')}
          </button>
          <button
            onClick={() => setDismissed(true)}
            aria-label={t('verify.dismiss')}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {open && (
        <AadhaarVerifyModal
          source="my_listings"
          subtitle={t('verify.subtitleMyListings')}
          onClose={() => setOpen(false)}
          onVerified={() => { setOpen(false); onVerified?.(); }}
        />
      )}
    </>
  );
}
