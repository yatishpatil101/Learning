import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import useScrollLock from '../../../hooks/useScrollLock.js';

export default function PhotoLightbox({ photos, active, setActive, title, onClose }) {
  const { t } = useTranslation();
  const touchX = useRef(null);
  const count = photos.length;
  const step = (dir) => setActive((i) => (i + dir + count) % count);

  useScrollLock(true);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setActive((i) => (i - 1 + count) % count);
      else if (e.key === 'ArrowRight') setActive((i) => (i + 1) % count);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, setActive, count]);

  return (
    <div className="dz-lightbox" role="dialog" aria-modal="true" aria-label={t('property.lightboxAria')} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button className="dz-lb-close" onClick={onClose} aria-label={t('property.close')}><Icon name="x" className="w-6 h-6" /></button>
      {count > 1 ? (
        <button className="dz-lb-nav" onClick={() => step(-1)} aria-label={t('property.prevPhoto')}><Icon name="chevron-left" className="w-7 h-7" /></button>
      ) : null}
      <div className="dz-lb-stage">
        <img
          src={photos[active]}
          alt={title}
          onTouchStart={(e) => { touchX.current = e.changedTouches[0].clientX; }}
          onTouchEnd={(e) => {
            if (touchX.current == null || count < 2) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
            touchX.current = null;
          }}
        />
        <p className="dz-lb-caption">{active + 1} / {count}</p>
      </div>
      {count > 1 ? (
        <button className="dz-lb-nav" onClick={() => step(1)} aria-label={t('property.nextPhoto')}><Icon name="chevron-right" className="w-7 h-7" /></button>
      ) : null}
    </div>
  );
}
