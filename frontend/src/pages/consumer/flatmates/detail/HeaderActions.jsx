import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { useToast } from '../../../../context/ToastContext.jsx';
import { shareOrCopy } from '../../../../lib/share.js';

export default function HeaderActions({ saved, onSave, shareText, onReport, reportLabel }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const share = async () => {
    const status = await shareOrCopy({ title: shareText, text: shareText, url: window.location.href });
    if (status === 'copied') toast(t('property.shareCopied'), 'success');
    if (status === 'failed') toast(t('property.shareCopyFail'), 'error');
  };
  const btn = 'seg w-11 h-11 rounded-xl text-gray-300 inline-flex items-center justify-center';
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button type="button" onClick={onSave} className={'save-btn ' + btn + (saved ? ' saved' : '')} aria-pressed={saved} aria-label={saved ? t('flatmates.saved') : t('flatmates.save')}><Icon name="heart" weight={saved ? 'fill' : 'regular'} className="w-4 h-4" /></button>
      <button type="button" onClick={share} className={btn} aria-label={t('flatmates.detailShare')}><Icon name="share-2" className="w-4 h-4" /></button>
      {onReport && <button type="button" onClick={onReport} className={'report-btn ' + btn} aria-label={reportLabel}><Icon name="flag" className="w-4 h-4" /></button>}
    </div>
  );
}
