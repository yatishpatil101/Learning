import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid } from 'lucide-react';
import { useToast } from '../../../context/ToastContext.jsx';
import { splitProperty } from '../../../services/flatmateService.js';
import SplitFlatModal from '../flatmates/SplitFlatModal.jsx';

/* Offered on the success screen of a brand-new RENT listing: the moment the
   owner is already thinking about how to fill the flat is the cheapest moment to
   ask whether they'd rather fill it one room at a time.

   It's an offer, never a step — the listing is already live either way, and the
   same action stays available later from My Listings. */
export default function PostSuccessSplitNudge({ listing }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  /* Through the seam, like the My Listings copy of this action. It used to call the mock
     `splitFlat()` directly, which wrote the rooms to this browser's `draazyRoomListings` — so an
     owner who accepted the nudge created supply that no seeker could ever be shown.

     The owner's identity comes off the token now rather than being passed in from `useAuth`, which
     is why this no longer reads the user at all: the server will not take a claimed `ownerMobile`,
     and it was never a fact the client should have been asserting. */
  const confirm = async ({ maxOccupants, rooms }) => {
    let created;
    try {
      created = await splitProperty(listing?.uuid || listing?.id, { maxOccupants, rooms });
    } catch (err) {
      toast(err?.body?.error || err?.message || t('listProperty.split.failed'), 'error');
      return;
    }
    setOpen(false);
    setDone(true);
    // A brand-new listing is always pending, so this path effectively always
    // reports the unbadged state — which is the honest thing to say.
    const count = created?.rooms?.length || rooms.length;
    const unbadged = (created?.rooms || []).some((r) => !r.verified);
    toast(
      unbadged ? t('listProperty.split.donePending', { count }) : t('listProperty.split.done', { count }),
      'success',
    );
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
