import SharedReportModal from '../../../components/ReportModal.jsx';

/* Property-listing adapter over the shared platform ReportModal. Maps a property
   object (`p`) onto the generic { target, kind } contract so existing callers keep
   working while all reporting flows through one component. */
export function ReportModal({ p, onClose, toast }) {
  return (
    <SharedReportModal
      target={{ id: p.id, title: p.title, ownerName: p.owner, ownerMobile: p.ownerMobile }}
      kind="listing"
      onClose={onClose}
      toast={toast}
    />
  );
}
