import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { StarInput } from './StarInput.jsx';
import { RV_CATS } from './ReviewsSection.jsx';

// No `user` prop: the author's display name is the server's answer, taken from the authenticated
// caller, not something the form carries. It was only ever needed to stamp the review locally.
export function ReviewModal({ onClose, onSubmit }) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [cats, setCats] = useState({});
  const [text, setText] = useState('');
  const [recommend, setRecommend] = useState(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const submit = () => {
    if (!rating) return;
    /**
     * Only what the author actually supplied.
     *
     * This used to also send `id`, `user`, `at` and `context: 'visit'`. All four are the server's
     * to decide, and `context` is the one that mattered: it is the "Visited" / "Verified resident"
     * badge, and sending it as a literal made every review self-certifying. The contract has no
     * such field on `ReviewCreate` for exactly that reason, so it was ignored live and believed on
     * mocks — the worst possible split, because the demo is where the badge got its credibility.
     */
    onSubmit({ rating, categories: cats, text: text.trim(), recommend });
  };

  return (
    <div className="dz-modal-backdrop" role="dialog" aria-modal="true" aria-label={t('property.rateProperty')} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dz-modal">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">{t('property.rateProperty')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t('property.rateSub')}</p>
          </div>
          <button onClick={onClose} className="dz-modal-x" aria-label={t('property.close')}><Icon name="x" className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-white mb-2">{t('property.overallRating')}</p>
            <StarInput value={rating} onChange={setRating} size={28} />
          </div>
          <div>
            <p className="text-sm font-semibold text-white mb-2">{t('property.rateByCategory')}</p>
            <div className="space-y-2">
              {RV_CATS.map(([k]) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="text-sm text-slate-300">{t('property.reviewCats.' + k)}</span>
                  <StarInput value={cats[k] || 0} onChange={(v) => setCats((c) => ({ ...c, [k]: v }))} size={18} aspect={t('property.reviewCats.' + k)} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-white mb-2">{t('property.yourReview')}</p>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={600} placeholder={t('property.reviewPlaceholder')} className="w-full rounded-xl bg-white/5 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-teal-2/50" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white mb-2">{t('property.wouldYouRecommend')}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setRecommend(true)} className={'flex-1 py-2 rounded-xl border text-sm font-medium inline-flex items-center justify-center gap-1.5 ' + (recommend === true ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 text-slate-300 hover:bg-white/5')}><Icon name="thumbs-up" className="w-4 h-4" /> {t('property.yes')}</button>
              <button type="button" onClick={() => setRecommend(false)} className={'flex-1 py-2 rounded-xl border text-sm font-medium inline-flex items-center justify-center gap-1.5 ' + (recommend === false ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-white/10 text-slate-300 hover:bg-white/5')}><Icon name="thumbs-down" className="w-4 h-4" /> {t('property.no')}</button>
            </div>
          </div>
          <button type="button" onClick={submit} disabled={!rating} className={'btn-teal w-full flex items-center justify-center gap-2 py-3 ' + (!rating ? 'opacity-50 cursor-not-allowed' : '')}><Icon name="check" className="w-4 h-4" /> {t('property.submitReview')}</button>
        </div>
      </div>
    </div>
  );
}
