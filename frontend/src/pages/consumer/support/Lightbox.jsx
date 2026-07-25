import { useTranslation } from 'react-i18next';

export default function Lightbox({ lightboxImg, setLightboxImg }) {
  const { t } = useTranslation();
  if (!lightboxImg) return null;
  return (
    <div
      onClick={() => setLightboxImg(null)}
      className="fixed inset-0 z-[1500] flex items-center justify-center p-6 bg-ink/92 cursor-zoom-out"
    >
      <img src={lightboxImg} alt={t('misc.lightboxAlt')} className="max-w-[92vw] max-h-[92vh] rounded-xl shadow-2xl" />
    </div>
  );
}
