import Modal from '../../../components/ui/Modal.jsx';
import { RotateCcw, Sparkles, UserCheck } from 'lucide-react';
import { getListing } from '../../../lib/store';

export default function ListPropertyModals({ ctx }) {
  const {
    t, showResetConfirm, setShowResetConfirm, confirmReset,
    showIdentityGuard, setShowIdentityGuard, showDupGuard, setShowDupGuard, dupExistingId, navigate,
  } = ctx;

  /**
   * "Go to the listing you already have."
   *
   * The editor is the better destination when it can actually open: the owner came here to describe
   * this property, and landing in the form for the one they already posted lets them finish the
   * thought. But the edit route prefills from the local store only, so it can open the form for a
   * listing this browser holds and nothing else. `dupExistingId` is a server id now, and on a device
   * that has never held that listing the editor renders empty — the owner is told "here is the one
   * you already have" and shown a blank form, which is worse than not offering the link.
   *
   * So: the editor when the record is here, the dashboard when it is not. The dashboard reads
   * through the seam, so it can always show them the listing even when this page cannot edit it.
   */
  const goToExisting = () => {
    if (dupExistingId && getListing(dupExistingId)) {
      navigate(`/list-property?edit=${dupExistingId}`);
      return;
    }
    navigate('/dashboard');
  };

  return (
    <>
      <Modal
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title={t('listProperty.modal.startOverTitle')}
        size="sm"
        footer={(
          <>
            <button
              type="button"
              onClick={() => setShowResetConfirm(false)}
              className="btn-outline px-5 py-2.5 rounded-xl text-gray-300 font-semibold text-sm"
            >
              {t('listProperty.modal.keepEditing')}
            </button>
            <button
              type="button"
              onClick={confirmReset}
              className="px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm inline-flex items-center gap-2 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> {t('listProperty.startOver')}
            </button>
          </>
        )}
      >
        <p className="text-sm text-gray-300 leading-relaxed">
          {t('listProperty.modal.startOverBody')}
        </p>
      </Modal>

      {/* P2 — identity-change guard. Changing property type / locality makes this
         a different property, so we stop the edit and point the owner to a plan
         rather than silently repurposing their listing to skip the paywall. */}
      <Modal
        open={showIdentityGuard}
        onClose={() => setShowIdentityGuard(false)}
        title={t('listProperty.modal.identityTitle')}
        size="sm"
        footer={(
          <>
            <button
              type="button"
              onClick={() => setShowIdentityGuard(false)}
              className="btn-outline px-5 py-2.5 rounded-xl text-gray-300 font-semibold text-sm"
            >
              {t('listProperty.modal.keepEditing')}
            </button>
            <button
              type="button"
              onClick={() => { setShowIdentityGuard(false); navigate('/plans'); }}
              className="btn-teal px-5 py-2.5 rounded-xl text-white font-semibold text-sm inline-flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" /> {t('listProperty.modal.postAsNew')}
            </button>
          </>
        )}
      >
        <p className="text-sm text-gray-300 leading-relaxed">
          {t('listProperty.modal.identityBodyPre')} <strong className="text-white">{t('listProperty.modal.identityBodyTerm')}</strong>{t('listProperty.modal.identityBodyPost')}
        </p>
      </Modal>

      {/* Duplicate-property guard — this owner already has this exact unit
         (same electricity meter / society+unit+pincode) listed, so we stop the
         second post and point them to the one they already have. The id comes
         from the server now (D226), so it names a listing that really exists —
         but see `goToExisting` for why that is not enough to open the editor. */}
      <Modal
        open={showDupGuard}
        onClose={() => setShowDupGuard(false)}
        title={t('listProperty.modal.dupTitle')}
        size="sm"
        footer={(
          <>
            <button
              type="button"
              onClick={() => setShowDupGuard(false)}
              className="btn-outline px-5 py-2.5 rounded-xl text-gray-300 font-semibold text-sm"
            >
              {t('listProperty.modal.keepEditing')}
            </button>
            <button
              type="button"
              onClick={() => { setShowDupGuard(false); goToExisting(); }}
              className="btn-teal px-5 py-2.5 rounded-xl text-white font-semibold text-sm inline-flex items-center gap-2"
            >
              <UserCheck className="w-4 h-4" /> {t('listProperty.modal.goExisting')}
            </button>
          </>
        )}
      >
        <p className="text-sm text-gray-300 leading-relaxed">
          {t('listProperty.modal.dupBodyPre')} <strong className="text-white">{t('listProperty.modal.dupBodyTerm')}</strong> {t('listProperty.modal.dupBodyPost')}
        </p>
      </Modal>
    </>
  );
}
