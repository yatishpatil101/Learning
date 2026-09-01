import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { referralContactsPerReward } from '../../lib/referralConfig.js';
import { getEntitlements } from '../../services/entitlementService.js';

/* Shown when a seeker has spent every free owner contact. Two honest ways out:
   refer a friend (free, +15 contacts each) or buy Seeker Plus (unlimited).
   Referrals only ever lift the contact quota — priority visit slots and the
   rest of the Seeker Plus perks remain paid-only, and the whole free route is
   withdrawn when Ops turns off the `referralRewards` flag.

   The used/allowance line is fetched rather than read from localStorage (D31b):
   this modal only ever opens in response to the server refusing a request, so
   the numbers it shows must come from the same place that refused. They arrive a
   moment after the modal does, which is why the sub-line renders only once they
   have — an invented "0 of 0" while waiting would be worse than nothing. */
export default function ContactsExhaustedModal({ onClose }) {
  const { t } = useTranslation();
  const { flagEnabled } = useAppFlags();
  const canRefer = flagEnabled('referralRewards');
  const [counts, setCounts] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    let alive = true;
    getEntitlements()
      .then((e) => { if (alive && e?.contacts) setCounts({ used: e.contacts.used, allowance: e.contacts.allowance }); })
      .catch(() => { if (alive) setCounts(null); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    // Save and restore the previous value: this modal can open over an already
    // scroll-locked surface (a sheet, the help drawer), and blanking it on close
    // would unlock the page underneath.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog, and hand it back to the trigger on close —
    // otherwise Tab walks the page behind the backdrop.
    const prevFocus = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (prevFocus instanceof HTMLElement) prevFocus.focus();
    };
  }, [onClose]);

  return (
    <div className="dz-modal-backdrop" role="dialog" aria-modal="true" aria-label={t('property.contactsExhausted.title')} data-testid="contacts-exhausted" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dz-modal">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">{t('property.contactsExhausted.title')}</h3>
            {counts && <p className="text-xs text-slate-400 mt-0.5">{t('property.contactsExhausted.sub', { used: counts.used, allowance: counts.allowance })}</p>}
          </div>
          <button ref={closeRef} onClick={onClose} className="dz-modal-x" aria-label={t('property.close')}><Icon name="x" className="w-5 h-5" /></button>
        </div>

        {/* Free path — refer. Withdrawn entirely when Ops disables referral rewards. */}
        {canRefer && (
          <Link
            to="/refer"
            onClick={onClose}
            data-testid="contacts-exhausted-refer"
            className="block rounded-xl border border-teal-500/30 bg-teal-500/[0.08] p-4 mb-3 transition-colors hover:bg-teal-500/[0.14]"
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon name="gift" className="w-4 h-4 text-teal-300" />
              <span className="text-sm font-bold text-white">{t('property.contactsExhausted.referTitle')}</span>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-500/15">{t('property.contactsExhausted.freeBadge')}</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">{t('property.contactsExhausted.referBody', { count: referralContactsPerReward })}</p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-300">
              {t('property.contactsExhausted.referCta')} <Icon name="arrow-right" className="w-4 h-4" />
            </span>
          </Link>
        )}

        {/* Paid path — always available; the premium perks never move behind a referral. */}
        <Link
          to="/checkout?plan=seeker-plus"
          onClick={onClose}
          data-testid="contacts-exhausted-plan"
          className="block rounded-xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:bg-white/[0.07]"
        >
          <div className="flex items-center gap-2 mb-1">
            <Icon name="crown" className="w-4 h-4 text-amber-300" />
            <span className="text-sm font-bold text-white">{t('property.contactsExhausted.planTitle')}</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">{t('property.contactsExhausted.planBody')}</p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-300">
            {t('property.contactsExhausted.planCta')} <Icon name="arrow-right" className="w-4 h-4" />
          </span>
        </Link>
      </div>
    </div>
  );
}
