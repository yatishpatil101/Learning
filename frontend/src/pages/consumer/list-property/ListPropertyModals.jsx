import Modal from '../../../components/ui/Modal.jsx';
import { RotateCcw, Sparkles, UserCheck } from 'lucide-react';

export default function ListPropertyModals({ ctx }) {
  const {
    t, showResetConfirm, setShowResetConfirm, confirmReset,
    showIdentityGuard, setShowIdentityGuard, showDupGuard, setShowDupGuard, dupExistingId, navigate,
  } = ctx;
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
         (same electricity meter / tax ID / society+unit+pincode) listed, so we
         stop the second post and point them to the one they already have. */}
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
              onClick={() => { setShowDupGuard(false); navigate(dupExistingId ? `/list-property?edit=${dupExistingId}` : '/dashboard'); }}
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
