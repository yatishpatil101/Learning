import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { splitFlat } from '../../../lib/data/flatSplit.js';
import SplitFlatModal from '../flatmates/SplitFlatModal.jsx';

/* Offered on the success screen of a brand-new RENT listing: the moment the
   owner is already thinking about how to fill the flat is the cheapest moment to
   ask whether they'd rather fill it one room at a time.

   It's an offer, never a step — the listing is already live either way, and the
   same action stays available later from My Listings. */
export default function PostSuccessSplitNudge({ listing }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  const confirm = ({ maxOccupants, rooms }) => {
    const res = splitFlat(listing, {
      maxOccupants,
      rooms,
      ownerMobile: user?.mobile || '',
      ownerName: user?.name || '',
    });
    if (!res.ok) { toast(res.message || t('listProperty.split.failed'), 'error'); return; }
    setOpen(false);
    setDone(true);
    // A brand-new listing is always pending, so this path effectively always
    // reports the unbadged state — which is the honest thing to say.
    toast(res.pending ? t('listProperty.split.donePending', { count: res.count }) : t('listProperty.split.done', { count: res.count }), 'success');
  };

  if (done) {
    return (
      <p className="mt-6 text-xs text-emerald-300 flex items-center justify-center gap-1.5">
        <LayoutGrid className="w-3.5 h-3.5" /> {t('listProperty.split.liveNote')}
      </p>
    );
  }

  return (
    <>
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left">
        <p className="text-sm font-semibold text-white">{t('listProperty.split.nudgeTitle')}</p>
        <p className="text-xs text-gray-400 mt-1 leading-relaxed">{t('listProperty.split.nudgeBody')}</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-ghost mt-3 h-9 inline-flex items-center gap-1.5 px-3.5 rounded-full text-teal-300 text-xs font-semibold"
        >
          <LayoutGrid className="w-3.5 h-3.5" /> {t('listProperty.split.nudgeCta')}
        </button>
      </div>
      {open && <SplitFlatModal listing={listing} onClose={() => setOpen(false)} onConfirm={confirm} />}
    </>
  );
}
