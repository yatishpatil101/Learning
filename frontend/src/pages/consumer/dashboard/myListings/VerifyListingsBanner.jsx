import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Star, X } from 'lucide-react';
import VerifyIdentityRedirect from '../../../../components/auth/VerifyIdentityRedirect.jsx';
import { useVerification } from '../../../../context/VerificationContext.jsx';
import { trackKyc } from '../../../../lib/kycTrack.js';
/* One badge lifts ALL of an owner's listings, so this is a single panel banner rather than per-card noise. */

export default function VerifyListingsBanner({ enquiryCount = 0 }) {
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
      <div data-testid="verify-listings-banner" className="relative mb-5 rounded-xl border border-amber-400/25 bg-gradient-to-r from-amber-400/[0.08] to-teal-400/[0.06] p-3.5 sm:p-4 sm:flex sm:items-center sm:gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1 pr-9 sm:pr-0">
          <div className="w-8 h-8 rounded-lg bg-amber-400/15 border border-amber-400/30 flex items-center justify-center shrink-0">
            <Star className="w-4 h-4 text-amber-300" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm leading-snug">{headline}</p>
            <p className="text-gray-400 text-xs leading-relaxed mt-1">
              {t('verify.bannerBody')}
            </p>
          </div>
        </div>
        <button
          onClick={() => { trackKyc('badge_cta_click', 'my_listings'); setOpen(true); }}
          className="btn-teal mt-3 w-full sm:mt-0 sm:w-auto shrink-0 inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-lg text-white font-semibold text-sm whitespace-nowrap"
        >
          <ShieldCheck className="w-4 h-4" /> {t('verify.bannerCta')}
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label={t('verify.dismiss')}
          className="tap-target absolute right-0.5 top-0.5 sm:static shrink-0 rounded-lg flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/5"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <VerifyIdentityRedirect
          source="my_listings"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
