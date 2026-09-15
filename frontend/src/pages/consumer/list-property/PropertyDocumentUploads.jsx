import { BadgeCheck, FileText, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { badgeDocumentProgress, docsFor, isLandType } from './constants.js';
import { FieldError } from './controls.jsx';
import { fld, lbl } from './styles.js';
import { DOCUMENT_ACCEPT, DOCUMENT_GUIDANCE_KEY, PDF_GUIDANCE_KEY } from '../../../lib/uploads/policy.js';

export default function PropertyDocumentUploads({ form, set, documents, errors, isMediaBusy, handleDocUpload }) {
  const { t } = useTranslation();
  const choices = docsFor(form.deal, form.propertyType, form.commercialType);
  const bill = choices.find((d) => d.key === 'Electricity Bill');
  const tax = choices.find((d) => d.key === 'Property Tax Receipt');
  const index = choices.find((d) => d.key === 'Index II');
  const records = choices.filter((d) => !d.verifies);
  const ready = badgeDocumentProgress(form.deal, documents) === 1;

  const upload = (doc) => (
    <div key={doc.key} data-err={doc.key}>
      <p className={lbl}>{doc.label} <span className="text-gray-500 font-normal">{t('listProperty.optional')}</span></p>
      <label className={`doc-upload focus-within:ring-2 focus-within:ring-teal-400 ${documents[doc.key] ? 'has-file' : ''} ${isMediaBusy ? 'opacity-60' : ''}`}>
        <input type="file" className="sr-only" accept={doc.originalPdf ? '.pdf,application/pdf' : DOCUMENT_ACCEPT}
          aria-label={`Upload ${doc.label}`} disabled={isMediaBusy} onChange={(e) => handleDocUpload(doc.key, e)} />
        <FileText className="w-5 h-5 text-teal-400 flex-shrink-0" />
        <span className="doc-name text-sm text-gray-400 truncate">{documents[doc.key]?.name || doc.cta}</span>
      </label>
      {errors[doc.key] && <FieldError show>{errors[doc.key]}</FieldError>}
      {doc.hint && <p className="text-gray-400 text-xs mt-1.5 leading-relaxed">{doc.hint}</p>}
    </div>
  );

  return (
    <section className="mb-8" aria-label="Property documents">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <BadgeCheck className="w-4 h-4 text-teal-400" /> {t('listProperty.photosDocs.docsHeader')}
      </h3>
      <div className="rounded-xl border border-teal-500/20 bg-teal-500/[0.06] p-4 sm:p-5">
        <h4 className="text-sm font-semibold text-teal-100">Get the Verified badge</h4>
        <p className="text-gray-300 text-xs mt-2 leading-relaxed">
          {form.deal === 'rent'
            ? 'For rent: a current electricity bill or property-tax receipt.'
            : 'For sale: Index II plus a current electricity bill or property-tax receipt.'}
          {' '}All documents are optional for publishing. Uploading does not grant a badge; staff must check the evidence.
        </p>
        <p className="text-gray-400 text-xs my-3 flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0 text-teal-400" />
          Staff review these documents privately. This is a property-document check, not identity verification or a legal title guarantee.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            {upload(bill)}
            <details className="mt-3" open={!!documents[tax.key] || undefined}>
              <summary className="text-xs text-teal-300 cursor-pointer py-3 min-h-[44px]">Don’t have a bill? Use a property-tax receipt</summary>
              {upload(tax)}
            </details>
          </div>
          {index && upload(index)}
        </div>
        {!isLandType(form.propertyType) && (
          <div className="mt-4">
            <label htmlFor="electricity-consumer-no" className={lbl}>{t('listProperty.fields.electricityConsumerNo')} <span className="text-gray-500 font-normal">{t('listProperty.optional')}</span></label>
            <input id="electricity-consumer-no" inputMode="numeric" maxLength={20} value={form.electricityConsumerNo}
              onChange={(e) => set('electricityConsumerNo', e.target.value.replace(/\D/g, ''))}
              placeholder={t('listProperty.ph.egElectricityConsumer')} aria-describedby="electricity-consumer-help" className={fld} />
            <p id="electricity-consumer-help" className="text-gray-400 text-xs mt-1.5">{t('listProperty.help.electricityConsumerHelp')}</p>
          </div>
        )}
        <p role="status" aria-label="Badge documents" className="text-xs text-teal-200 mt-4">
          {ready ? 'Badge documents ready for staff review — not yet verified.' : 'You can publish without a badge and provide these documents later.'}
        </p>
        <p className="text-gray-400 text-xs mt-3 leading-relaxed">{t(PDF_GUIDANCE_KEY)}</p>
      </div>
      <details className="mt-4 rounded-xl border border-white/10 p-4">
        <summary className="text-sm font-semibold text-gray-200 cursor-pointer min-h-[44px] py-3">Other documents — optional, for your records</summary>
        <p className="text-gray-400 text-xs mb-4 leading-relaxed">{t(DOCUMENT_GUIDANCE_KEY)} {t('listProperty.photosDocs.otherDocsNote')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{records.map(upload)}</div>
      </details>
    </section>
  );
}