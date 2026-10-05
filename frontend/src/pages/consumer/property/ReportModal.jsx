import SharedReportModal from '../../../components/ReportModal.jsx';

export function ReportModal({ p, onClose, toast }) {
  return (
    <SharedReportModal
      target={{ id: p.uuid || p.id, title: p.title, ownerName: p.owner, ownerMobile: p.ownerMobile }}
      kind="listing"
      onClose={onClose}
      toast={toast}
    />
  );
}
