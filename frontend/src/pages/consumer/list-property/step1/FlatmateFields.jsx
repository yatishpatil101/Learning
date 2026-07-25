import { Users, ImagePlus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LocalitySelect from '../../../../components/ui/LocalitySelect.jsx';
import DateField from '../../../../components/ui/DateField';
import { Pill, FieldError } from '../controls.jsx';
import SocietySelect from '../SocietySelect.jsx';
import { fld, lbl, lbl3 } from '../styles.js';
import { localities, lifestyleTags } from '../constants.js';

const FlatmateFields = ({
  form, set, errors, isHouse, money, toggleInArray,
  handlePhotoUpload, photos, removePhoto, submitFlatmate,
}) => {
  const { t: tr } = useTranslation();
  return (
    /* ===== Flatmate form ===== */
    <div className="lp-step mt-2">
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label className={lbl3}>{tr('listProperty.fields.flatType')}</label>
          <div className={`flex flex-wrap gap-2.5 ${errors.bhk ? 'pn-invalid-group' : ''}`} data-err="bhk">
            {['1', '2', '3', '4'].map((n) => (
              <Pill key={n} selected={form.bhk === n} onClick={() => set('bhk', n)} className="px-5 py-2.5">{n === '4' ? '4+ BHK' : `${n} BHK`}</Pill>
            ))}
          </div>
          <FieldError show={!!errors.bhk}>{tr('listProperty.err.flatType')}</FieldError>
        </div>
        <div>
          <label className={lbl3}>{tr('listProperty.fields.roomOffered')}</label>
          <div className={`flex flex-wrap gap-2.5 ${errors.roomType ? 'pn-invalid-group' : ''}`} data-err="roomType">
            {['Private room', 'Shared room'].map((r) => (
              <Pill key={r} selected={form.roomType === r} onClick={() => set('roomType', r)} className="px-5 py-2.5">{r}</Pill>
            ))}
          </div>
          <FieldError show={!!errors.roomType}>{tr('listProperty.err.roomType')}</FieldError>
        </div>
      </div>

      <div className="mb-6">
        <label className={lbl3}>{tr('listProperty.fields.furnishing')}</label>
        <div className="flex flex-wrap gap-3">
          {[['unfurnished', tr('listProperty.opt.unfurnished')], ['semi', tr('listProperty.opt.semiFurnished')], ['furnished', tr('listProperty.opt.furnished')]].map(([v, l]) => (
            <Pill key={v} selected={form.furnishing === v} onClick={() => set('furnishing', v)} className="px-6 py-3">{l}</Pill>
          ))}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>{tr('listProperty.fields.locality')}</label>
          <LocalitySelect value={form.locality} onChange={(v) => set('locality', v)} placeholder={tr('listProperty.ph.selectLocality')} options={localities} dataErr="locality" invalid={!!errors.locality} />
          <FieldError show={!!errors.locality}>{tr('listProperty.err.locality')}</FieldError>
        </div>
        <div>
          <label className={lbl}>{isHouse() ? tr('listProperty.fields.houseBuildingName') : tr('listProperty.fields.societyBuilding')}</label>
          {isHouse() ? (
            <input value={form.society} onChange={(e) => set('society', e.target.value)} data-err="society" placeholder={tr('listProperty.ph.egGreenVilla')} className={`${fld} ${errors.society ? 'pn-invalid' : ''}`} />
          ) : (
            <SocietySelect value={form.societyId} name={form.society} localityLabel={form.locality} lat={form.propLat} lng={form.propLng} pincode={form.pincode} invalid={!!errors.society} onChange={({ id, name }) => { set('societyId', id); set('society', name); }} />
          )}
          <FieldError show={!!errors.society}>{isHouse() ? tr('listProperty.err.enterHouseName') : tr('listProperty.err.enterSocietyName')}</FieldError>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className={lbl}>{tr('listProperty.fields.yourShareRent')}</label>
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
            <input inputMode="numeric" {...money('rentShare')} data-err="rentShare" placeholder={tr('listProperty.ph.egRentShare')} className={`${fld} pl-10 pr-14 ${errors.rentShare ? 'pn-invalid' : ''}`} />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{tr('listProperty.unit.perMo')}</div>
          </div>
          <FieldError show={!!errors.rentShare}>{tr('listProperty.err.rentShare')}</FieldError>
        </div>
        <div>
          <label className={lbl}>{tr('listProperty.fields.securityDeposit')}</label>
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
            <input inputMode="numeric" {...money('deposit')} placeholder={tr('listProperty.ph.egDeposit28')} className={`${fld} pl-10 pr-4`} />
          </div>
        </div>
        <div>
          <label className={lbl}>{tr('listProperty.fields.availableFrom')}</label>
          <DateField value={form.availableFrom} onChange={(v) => set('availableFrom', v)} dataErr="availableFrom" ariaLabel={tr('listProperty.aria.availableFrom')} invalid={!!errors.availableFrom} className={fld} />
          <FieldError show={!!errors.availableFrom}>{tr('listProperty.err.availableRoom')}</FieldError>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label className={lbl3}>{tr('listProperty.fields.lookingFor')}</label>
          <div className="flex flex-wrap gap-2.5">
            {[['any', tr('listProperty.opt.anyone')], ['female', tr('listProperty.opt.women')], ['male', tr('listProperty.opt.men')]].map(([v, l]) => (
              <Pill key={v} selected={form.lookingFor === v} onClick={() => set('lookingFor', v)} className="px-5 py-2.5">{l}</Pill>
            ))}
          </div>
        </div>
        <div>
          <label className={lbl3}>{tr('listProperty.fields.foodPreference')}</label>
          <div className="flex flex-wrap gap-2.5">
            {[['any', tr('listProperty.opt.any')], ['veg', tr('listProperty.opt.vegOnly')], ['nonveg', tr('listProperty.opt.nonvegOk')]].map(([v, l]) => (
              <Pill key={v} selected={form.foodPref === v} onClick={() => set('foodPref', v)} className="px-5 py-2.5">{l}</Pill>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-6">
        <label className={lbl3}>{tr('listProperty.fields.lifestyle')} <span className="text-gray-500 font-normal">{tr('listProperty.optional')}</span></label>
        <div className="flex flex-wrap gap-2.5">
          {lifestyleTags.map((t) => (
            <Pill key={t} selected={form.lifestyle.includes(t)} onClick={() => toggleInArray('lifestyle', t)} className="px-4 py-2">{t}</Pill>
          ))}
        </div>
      </div>

      <div className="mb-6" data-err="photos">
        <label className={lbl}>{tr('listProperty.fields.roomPhotos')}</label>
        <p className="text-gray-500 text-xs mb-3">{tr('listProperty.help.roomPhotosHelp')}</p>
        <label className={`upload-zone rounded-2xl p-6 text-center cursor-pointer block ${errors.photos ? 'pn-invalid' : ''}`}>
          <input type="file" className="hidden" multiple accept="image/*" onChange={handlePhotoUpload} />
          <div className="w-12 h-12 rounded-2xl bg-teal-400/10 border border-teal-400/20 flex items-center justify-center mx-auto mb-3"><ImagePlus className="w-6 h-6 text-teal-400" /></div>
          <p className="text-white font-medium text-sm mb-0.5">{tr('listProperty.ph.clickAddRoomPhotos')}</p>
          <p className="text-gray-500 text-xs">{tr('listProperty.ph.pngUpTo10')}</p>
        </label>
        {errors.photos && <FieldError show>{tr('listProperty.err.addRoomPhoto')}</FieldError>}
        {photos.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mt-3">
            {photos.map((p, i) => (
              <div key={i} className="relative rounded-xl overflow-hidden aspect-square">
                <img src={p.url} alt="" className="w-full h-full object-cover" />
                <button onClick={() => removePhoto(i)} className="absolute top-1 right-1 bg-black/60 rounded-full p-1"><X className="w-3 h-3 text-white" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-8">
        <label className={lbl3}>{tr('listProperty.fields.shortNote')} <span className="text-gray-500 font-normal">{tr('listProperty.optional')}</span></label>
        <textarea rows={3} value={form.note} onChange={(e) => set('note', e.target.value)} placeholder={tr('listProperty.ph.notePlaceholder')} className={`${fld} resize-none`} />
      </div>

      <div className="flex justify-end">
        <button onClick={submitFlatmate} className="btn-teal px-8 py-3.5 rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20">
          <Users className="w-4 h-4" /> {tr('listProperty.flatmate.postFind')}
        </button>
      </div>
    </div>
  );
};

export default FlatmateFields;
