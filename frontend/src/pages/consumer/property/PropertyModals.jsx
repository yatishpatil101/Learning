import { useCallback } from 'react';
import Icon from '../../../components/Icon.jsx';
import PhotoLightbox from './PhotoLightbox.jsx';
import { ContactOwnerModal } from './ContactOwnerModal.jsx';
import { ScheduleVisitModal } from './ScheduleVisitModal.jsx';
import { ReportModal } from './ReportModal.jsx';
import InlineOtpSheet from '../../../components/auth/InlineOtpSheet.jsx';

export default function PropertyModals({ ctx }) {
  const {
    contactOpen, setContactOpen,
    visitOpen, setVisitOpen, reportOpen, setReportOpen,
    lightbox, setLightbox, tourOpen, setTourOpen,
    p, isIn, toast, tr, flagEnabled,
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

      {lightbox ? <PhotoLightbox photos={gallery} active={active} setActive={setActive} title={title} onClose={closeLightbox} /> : null}

      {tourOpen ? (
        <div className="dz-lightbox" role="dialog" aria-modal="true" aria-label={tr('property.virtualTourAria')} onClick={(e) => { if (e.target === e.currentTarget) setTourOpen(false); }}>
          <button className="dz-lb-close" onClick={() => setTourOpen(false)} aria-label={tr('property.close')}><Icon name="x" className="w-6 h-6" /></button>
          <div className="dz-tour-frame">
            <iframe src="https://www.youtube.com/embed/Z7m2T8N5pWk?autoplay=1&rel=0" title={tr('property.virtualTourTitle')} frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
          </div>
        </div>
      ) : null}
    </>
  );
}
