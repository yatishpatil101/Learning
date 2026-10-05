import { ImageOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function NoPhotoPlaceholder({ className = '', label, ...props }) {
  const { t } = useTranslation();
  const text = label || t('common.noPhotos.placeholder');
  return (
    <div
      role="img"
      aria-label={text}
      className={`${className} flex flex-col items-center justify-center gap-2 bg-white/[0.04] text-center text-slate-400`.trim()}
      {...props}
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-500">
        <ImageOff className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="px-2 text-[11px] font-semibold leading-tight">{text}</span>
    </div>
  );
}
