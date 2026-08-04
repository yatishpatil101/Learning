import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { useCompare } from '../../../context/CompareContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { shareOrCopy } from '../../../lib/share.js';
import { toggleSavedProp } from '../../../lib/store.js';

export function CompareToggleBar({ p, saved, setSaved }) {
  const { t } = useTranslation();
  const { has, toggle, count } = useCompare();
  const { toast } = useToast();
  const inCompare = has(p.id);
  const handleSave = () => {
    const nowSaved = toggleSavedProp(p.id);
    setSaved(nowSaved);
  };

  // Share the listing, falling back to a clipboard copy where the OS share sheet
  // doesn't exist (desktop, and any browser without navigator.share). The cancel
  // path — dismissing the sheet rejects with AbortError — used to fall into the
  // clipboard catch and raise "Couldn't copy link" for something that worked
  // exactly as intended. That logic now lives in lib/share.js so every surface
  // treats a cancel the same way.
  const share = async () => {
    const status = await shareOrCopy({ title: p.title || 'PuneNest listing' });
    if (status === 'copied') toast(t('property.shareCopied'), 'success');
    if (status === 'failed') toast(t('property.shareCopyFail'), 'error');
  };

  const toggleThis = () => {
    if (!inCompare && count >= 4) {
      alert(t('property.compareLimitAlert'));
      return;
    }
    toggle(p.id);
  };

  return (
    <div className="flex gap-3">
      <button className={'icon-btn flex-1 ' + (saved ? 'saved' : '')} onClick={handleSave} aria-label={t('property.saveProperty')} aria-pressed={saved} title={t('property.saveProperty')}><Icon name="heart" className={'w-5 h-5 ' + (saved ? 'text-red-500' : 'text-slate-400')} /></button>
      <button className={'icon-btn flex-1 relative ' + (inCompare ? 'bg-brand-teal-1/20 border-brand-teal-2/40' : '')} onClick={toggleThis} aria-label={inCompare ? t('property.removeFromCompare') : t('property.addToCompare')} aria-pressed={inCompare} title={inCompare ? t('property.removeFromCompare') : t('property.addToCompare')}><Icon name="git-compare" className={'w-5 h-5 ' + (inCompare ? 'text-brand-teal-3' : 'text-slate-400')} /></button>
      <Link to="/compare" className="icon-btn flex-1 relative" aria-label={t('property.viewCompare')} title={t('property.viewCompare')}><Icon name="list" className="w-5 h-5 text-slate-400" />{count > 0 ? <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-brand-teal-3 text-xs font-bold flex items-center justify-center text-ink">{count}</span> : null}</Link>
      <button className="icon-btn flex-1" onClick={() => void share()} aria-label={t('property.share')} title={t('property.share')}><Icon name="share-2" className="w-5 h-5 text-slate-400" /></button>
    </div>
  );
}
