import Icon from '../../../components/Icon.jsx';
import MobileField from '../../../components/MobileField.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import { useTranslation } from 'react-i18next';
import { CATEGORIES, PRIORITIES, MAX_IMAGES, getCatLabel, getPrioLabel } from '../../../lib/data/support.js';

export default function TicketForm({ form, set, fld, filesInRef, newImgs, setNewImgs, handleFiles, removeImg, submit }) {
  const { t } = useTranslation();
  return (
    <div className="glass-card rounded-2xl p-6 sm:p-7 reveal">
      <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
        <Icon name="ticket-plus" className="w-5 h-5 text-teal-400" /> {t('misc.tfRaiseNew')}
      </h2>
      <p className="text-gray-500 text-xs mb-5">
        {t('misc.tfReplyNote')}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('misc.tfYourName')} <span className="text-rose-400">*</span>
          </label>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            type="text"
            placeholder={t('misc.tfYourNamePlaceholder')}
            className={fld}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('misc.tfMobile')} <span className="text-rose-400">*</span>
          </label>
          <MobileField value={form.mobile} onChange={(v) => set('mobile', v)} placeholder={t('misc.tfMobilePlaceholder')} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('misc.tfCategory')} <span className="text-rose-400">*</span>
          </label>
          <NativeSelect value={form.category} onChange={(e) => set('category', e.target.value)} className={fld}>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {getCatLabel(c.key)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">{t('misc.tfPriority')}</label>
          <NativeSelect value={form.priority} onChange={(e) => set('priority', e.target.value)} className={fld}>
            {PRIORITIES.map((p) => (
              <option key={p.key} value={p.key}>
                {getPrioLabel(p.key)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('misc.tfSubject')} <span className="text-rose-400">*</span>
          </label>
          <input
            value={form.subject}
            onChange={(e) => set('subject', e.target.value)}
            maxLength={120}
            type="text"
            placeholder={t('misc.tfSubjectPlaceholder')}
            className={fld}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('misc.tfDescribe')} <span className="text-rose-400">*</span>
          </label>
          <textarea
            value={form.message}
            onChange={(e) => set('message', e.target.value)}
            rows={4}
            placeholder={t('misc.tfDescribePlaceholder')}
            className={fld + ' resize-none'}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('misc.tfAttach')} <span className="text-gray-500 font-normal">{t('misc.tfOptionalUpTo', { max: MAX_IMAGES })}</span>
          </label>
          <div
            onClick={() => filesInRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-teal-400/60', 'bg-teal-400/6'); }}
            onDragLeave={(e) => { e.currentTarget.classList.remove('border-teal-400/60', 'bg-teal-400/6'); }}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-teal-400/60', 'bg-teal-400/6'); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files, newImgs, setNewImgs); }}
            className="dropzone px-4 py-5 flex flex-col items-center justify-center text-center border-[1.5px] border-dashed border-white/16 rounded-2xl cursor-pointer hover:border-teal-400/60 hover:bg-teal-400/6 transition-all"
          >
            <Icon name="image-plus" className="w-6 h-6 text-gray-400 mb-1.5" />
            <p className="text-sm text-gray-300 font-medium">{t('misc.tfUploadCta')}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{t('misc.tfUploadHint')}</p>
            <input
              ref={filesInRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files, newImgs, setNewImgs);
                e.target.value = '';
              }}
            />
          </div>
          {newImgs.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {newImgs.map((im, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
                  <img src={im.data} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeImg(newImgs, setNewImgs, i)}
                    className="absolute top-0.5 right-0.5 w-[18px] h-[18px] rounded-full bg-ink/80 flex items-center justify-center text-white hover:bg-red-500"
                  >
                    <Icon name="x" className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={submit}
        className="btn-teal w-full mt-5 py-3.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"
      >
        <Icon name="send" className="w-4 h-4" /> {t('misc.tfSubmit')}
      </button>
    </div>
  );
}
