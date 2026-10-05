import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Tip from '../../../components/ui/Tip.jsx';
import { getFlatmateDetail } from '../../../services/flatmateService.js';

const META = {
  pending: ['clock', 'text-amber-300', 'agreementUnderReview', 'reviewInfoPending'],
  approved: ['shield-check', 'text-emerald-300', 'agreementVerified', 'reviewInfoApproved'],
  rejected: ['shield-alert', 'text-rose-300', 'agreementNotVerified', 'reviewInfoRejected'],
};

function useHostVerification(owned, kind, id) {
  const [v, setV] = useState(null);
  useEffect(() => {
    if (!owned || !kind || !id) return undefined;
    let live = true;
    getFlatmateDetail(kind, id).then((d) => live && setV(d.verification || null)).catch(() => {});
    return () => { live = false; };
  }, [owned, kind, id]);
  return v;
}

function hostMessage(v, t) {
  if (!v) return null;
  if (v.status === 'rejected') return [v.reason, t('flatmates.reviewRejectedFix')].filter(Boolean).join(' ');
  if (v.status !== 'pending') return null;
  return v.ownerConsent
    ? t('flatmates.reviewAllSet')
    : t('flatmates.reviewWaitingOn', { steps: t('flatmates.reviewStepConsent') });
}

export default function ReviewChip({ status, kind, id, owned }) {
  const { t } = useTranslation();
  const verification = useHostVerification(owned, kind, id);
  const meta = META[status];
  if (!meta) return null;
  const label = t('flatmates.' + meta[2]);
  return (
    <Tip title={label} body={hostMessage(verification, t) || t('flatmates.' + meta[3])}>
      <button type="button" className={'chip relative z-[1] px-2 py-0.5 rounded-md text-[10px] font-bold inline-flex items-center gap-1 ' + meta[1]}>
        <Icon name={meta[0]} className="w-2.5 h-2.5" /> {label} <Icon name="info" className="w-2.5 h-2.5 opacity-70" />
      </button>
    </Tip>
  );
}
