import Icon from '../../../components/Icon.jsx';
import { ContactOwnerModal } from './ContactOwnerModal.jsx';
import { ScheduleVisitModal } from './ScheduleVisitModal.jsx';
import { ReportModal } from './ReportModal.jsx';

export default function PropertyModals({ ctx }) {
  const {
    contactOpen, setContactOpen,
    visitOpen, setVisitOpen, reportOpen, setReportOpen,
    lightbox, setLightbox, tourOpen, setTourOpen,
    p, isIn, toast, tr, flagEnabled,
    gallery, active, setActive, title, lbTouchX,
  } = ctx;
  return (
    <>
      {contactOpen ? <ContactOwnerModal p={p} isIn={isIn} onClose={() => setContactOpen(false)} toast={toast} /> : null}
      {visitOpen && flagEnabled('scheduleVisit') ? <ScheduleVisitModal p={p} isIn={isIn} onClose={() => setVisitOpen(false)} toast={toast} /> : null}
      {reportOpen ? <ReportModal p={p} onClose={() => setReportOpen(false)} toast={toast} /> : null}

      {lightbox ? (
        <div className="dz-lightbox" role="dialog" aria-modal="true" aria-label={tr('property.lightboxAria')} onClick={(e) => { if (e.target === e.currentTarget) setLightbox(false); }}>
          <button className="dz-lb-close" onClick={() => setLightbox(false)} aria-label={tr('property.close')}><Icon name="x" className="w-6 h-6" /></button>
          {gallery.length > 1 ? (
            <button className="dz-lb-nav" onClick={() => setActive((i) => (i - 1 + gallery.length) % gallery.length)} aria-label={tr('property.prevPhoto')}><Icon name="chevron-left" className="w-7 h-7" /></button>
          ) : null}
          <div className="dz-lb-stage">
            <img
              src={gallery[active]}
              alt={title}
              onTouchStart={(e) => { lbTouchX.current = e.changedTouches[0].clientX; }}
              onTouchEnd={(e) => {
                if (lbTouchX.current == null || gallery.length < 2) return;
                const dx = e.changedTouches[0].clientX - lbTouchX.current;
                if (Math.abs(dx) > 40) setActive((i) => (i + (dx < 0 ? 1 : -1) + gallery.length) % gallery.length);
                lbTouchX.current = null;
              }}
            />
            <p className="dz-lb-caption">{active + 1} / {gallery.length}</p>
          </div>
          {gallery.length > 1 ? (
            <button className="dz-lb-nav" onClick={() => setActive((i) => (i + 1) % gallery.length)} aria-label={tr('property.nextPhoto')}><Icon name="chevron-right" className="w-7 h-7" /></button>
          ) : null}
        </div>
      ) : null}

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
