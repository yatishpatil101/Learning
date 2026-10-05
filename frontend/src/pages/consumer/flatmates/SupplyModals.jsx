import PostModal from './PostModal.jsx';
import GroupModal from './GroupModal.jsx';
import OwnerConsentModal from '../../../components/auth/OwnerConsentModal.jsx';

export default function SupplyModals({ s }) {
  const { grp, setGrp, toast, t } = s;
  return (
    <>
      {s.postOpen && (
        <PostModal setPostOpen={s.setPostOpen} submitPost={s.submitPost} postFormRef={s.postFormRef} postDraft={s.postDraft} post={s.post} setPost={s.setPost} postErr={s.postErr} editingId={s.editingId} />
      )}

      {s.groupOpen && (
        <GroupModal setGroupOpen={s.setGroupOpen} submitGroup={s.submitGroup} grpFormRef={s.grpFormRef} grpDraft={s.grpDraft} grp={grp} setGrp={setGrp} grpErr={s.grpErr} myListings={s.myApprovedListings} myListingsStatus={s.myApprovedListingsStatus} retryMyListings={s.retryMyApprovedListings} myTenancies={s.myTenancies} myTenanciesStatus={s.myTenanciesStatus} retryMyTenancies={s.retryMyTenancies} onAttachProperty={s.prefillGroupFromListing} onAttachTenancy={s.prefillGroupFromTenancy} onRequestConsent={s.openConsent} editing={!!s.editingGroupId} />
      )}

      {s.consentOpen && (
        <OwnerConsentModal
          ownerMobile={grp.consentMobile}
          title={grp.title}
          locality={grp.locality}
          onClose={() => s.setConsentOpen(false)}
          onVerified={() => { setGrp((g) => ({ ...g, consentVerified: true })); toast(t('flatmates.ownerConsentConfirmedToast'), 'success'); }}
        />
      )}
    </>
  );
}
