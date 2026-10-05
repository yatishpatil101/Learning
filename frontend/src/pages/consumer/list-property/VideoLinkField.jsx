import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError } from './controls.jsx';
import { fld, lbl3 } from './styles.js';
import { normalizeYouTubeId } from './video.js';

export default function VideoLinkField({ value, onChange, error }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value || '');

  useEffect(() => {
    setDraft(value || '');
  }, [value]);

  const commit = (raw) => {
    setDraft(raw);
    const parsed = normalizeYouTubeId(raw);
    onChange(parsed.ok ? parsed.id : raw.trim());
  };

  return (
    <div className="mb-6">
      <label className={lbl3}>{t('listProperty.content.youtube.label')}</label>
      <input
        value={draft}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => {
          const parsed = normalizeYouTubeId(draft);
          if (parsed.ok) setDraft(parsed.id);
        }}
        placeholder={t('listProperty.content.youtube.placeholder')}
        data-err="youtubeId"
        className={`${fld} ${error ? 'dz-invalid' : ''}`}
      />
      <FieldError show={!!error}>{t('listProperty.content.youtube.error')}</FieldError>
      <p className="mt-1.5 text-xs text-gray-500">{t('listProperty.content.youtube.hint')}</p>
    </div>
  );
}
