import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { useCompare } from '../../../context/CompareContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
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

  // Copy the listing URL and confirm — a silent copy leaves the user unsure it worked.
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) { await navigator.share({ title: p.title || 'PuneNest listing', url }); return; }      await navigator.clipboard.writeText(url);
      toast(t('property.shareCopied'), 'success');
    } catch {
      toast(t('property.shareCopyFail'), 'error');
    }
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
