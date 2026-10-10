import { useCallback } from 'react';
import PhotoLightbox from './PhotoLightbox.jsx';
import { ContactOwnerModal } from './ContactOwnerModal.jsx';
import { ScheduleVisitModal } from './ScheduleVisitModal.jsx';
import { ReportModal } from './ReportModal.jsx';
import InlineOtpSheet from '../../../components/auth/InlineOtpSheet.jsx';

export default function PropertyModals({ ctx }) {
  const {
    contactOpen, setContactOpen,
    visitOpen, setVisitOpen, reportOpen, setReportOpen,
    lightbox, setLightbox,
    p, isIn, toast, flagEnabled,
    inlineOtpReason, closeInlineOtp, onInlineOtpVerified,
    gallery, active, setActive, title,
  } = ctx;
  const closeLightbox = useCallback(() => setLightbox(false), [setLightbox]);
  return (
    <>
      <InlineOtpSheet open={!!inlineOtpReason} reason={inlineOtpReason || 'contact'} onClose={closeInlineOtp} onVerified={onInlineOtpVerified} />
      {contactOpen ? <ContactOwnerModal p={p} isIn={isIn} onClose={() => setContactOpen(false)} toast={toast} /> : null}
      {visitOpen && flagEnabled('scheduleVisit') ? <ScheduleVisitModal p={p} isIn={isIn} onClose={() => setVisitOpen(false)} toast={toast} /> : null}
      {reportOpen ? <ReportModal p={p} onClose={() => setReportOpen(false)} toast={toast} /> : null}

      {lightbox && gallery[active] ? <PhotoLightbox photos={gallery} active={active} setActive={setActive} title={title} onClose={closeLightbox} /> : null}

    </>
  );
}
