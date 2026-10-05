import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import FieldError from './FieldError.jsx';
import { HEADLINE_MAX } from '../../lib/headline.js';

export default function HeadlineField({ value, onChange, suggestion, error, className = '', labelClassName = '', inputClassName = '' }) {
  const { t } = useTranslation();
  const id = useId();
  const text = value ?? '';
  const offerSuggestion = suggestion && text.trim() !== suggestion;
  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={id} className={labelClassName}>{t('common.headline.label')}</label>
        {offerSuggestion ? (
          <button type="button" onClick={() => onChange(suggestion)} className="text-xs font-semibold text-teal-300 hover:text-teal-200">
            {t('common.headline.useSuggestion')}
          </button>
        ) : null}
      </div>
      <input
        id={id}
        type="text"
        value={text}
        maxLength={HEADLINE_MAX}
        onChange={(e) => onChange(e.target.value)}
        placeholder={suggestion || t('common.headline.placeholder')}
        aria-invalid={!!error}
        data-err="title"
        className={`${inputClassName} ${error ? 'dz-invalid' : ''}`.trim()}
      />
      <div className="mt-1.5 flex items-start justify-between gap-3">
        {error
          ? <FieldError show>{error}</FieldError>
          : <p className="text-xs text-gray-500">{t('common.headline.hint')}</p>}
        <p className="ml-auto shrink-0 text-xs text-gray-500">{text.length}/{HEADLINE_MAX}</p>
      </div>
    </div>
  );
}
