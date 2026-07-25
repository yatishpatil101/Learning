import Badge from '../../../../components/ui/Badge.jsx';

export default function DocPill({ status }) {
  if (status === 'verified') return <Badge status="approved">Verified</Badge>;
  if (status === 'rejected') return <Badge status="rejected">Rejected</Badge>;
  return <Badge status="pending">Pending</Badge>;
}
