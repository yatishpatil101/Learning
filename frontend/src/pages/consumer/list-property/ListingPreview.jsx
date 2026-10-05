import { CheckCircle2, Pencil, ImageOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Modal from '../../../components/ui/Modal.jsx';
import { formatIndian, perUnit } from './format.js';
import { listingLabels } from './submit.js';
import { headlineOf } from '../../../lib/headline.js';
import { isLandType, isResidentialType, plotUnitOptions, farmUnitOptions } from './constants.js';

const UNIT_LABELS = Object.fromEntries([...plotUnitOptions, ...farmUnitOptions]);
const FURNISHING_KEYS = { unfurnished: 'unfurnished', semi: 'semiFurnished', furnished: 'furnished' };
const POSSESSION_KEYS = { ready: 'readyToMove', new: 'newLaunch', under: 'underConstruction' };
const TENANT_KEYS = { family: 'family', bachelors: 'bachelors', 'bachelor-male': 'bachelorMale', 'bachelor-female': 'bachelorFemale', company: 'companyLease', anyone: 'anyone' };

const rupees = (v) => (formatIndian(v) ? `₹${formatIndian(v)}` : '');
const dateIn = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fallbackUnitLabel = (unit) => ({
  sqft: 'sq.ft', sqm: 'sq.m', sqyd: 'sq.yd', guntha: 'guntha', acre: 'acre', hectare: 'hectare',
}[unit] || 'sq.ft');

function sectionsFor(form, t) {
  const label = (key) => t(`listProperty.fields.${key}`).replace(/\s*\*$/, '');
  const opt = (key) => (key ? t(`listProperty.opt.${key}`) : '');
  const rent = form.deal === 'rent';
  const land = isLandType(form.propertyType);
  const areaUnit = land ? (UNIT_LABELS[form.areaUnit] || form.areaUnit || 'sq.ft') : 'sq.ft';
  const priceUnit = land ? t(`listProperty.unit.${form.areaUnit}`, { defaultValue: fallbackUnitLabel(form.areaUnit) }) : 'sq.ft';
  const area = form.carpetArea ? `${form.carpetArea} ${areaUnit}` : '';
  const maintenance = form.rentMaintMode === 'included' ? opt('includedInRent')
    : form.rentMaintenance ? `${rupees(form.rentMaintenance)} ${t('listProperty.unit.perMonth')}` : '';
  return [
    { step: 1, title: t('listProperty.stepNav.details'), rows: [
      [label(!land ? 'carpetArea' : form.propertyType === 'farmland' ? 'landArea' : 'plotAreaLabel'), area],
      [label('floorNo'), form.floor && (form.totalFloors ? `${form.floor} / ${form.totalFloors}` : form.floor)],
      [label('furnishing'), isResidentialType(form.propertyType) && opt(FURNISHING_KEYS[form.furnishing])],
      [label('facing'), form.facing],
    ] },
    { step: 2, title: t('listProperty.stepNav.location'), rows: [
      [label('societyBuilding'), form.society],
      [label('locality'), [form.locality, 'Pune'].filter(Boolean).join(', ')],
      [label('pincode'), form.pincode],
    ] },
    { step: 3, title: t('listProperty.stepNav.pricing'), rows: rent ? [
      [label('monthlyRent'), form.monthlyRent && `${rupees(form.monthlyRent)} ${t('listProperty.unit.perMonth')}`],
      [label('securityDeposit'), rupees(form.deposit)],
      [label('maintenanceCharges'), maintenance],
      [label('availableFrom'), dateIn(form.availableFrom)],
      [label('preferredTenants'), form.preferredTenants.map((v) => opt(TENANT_KEYS[v])).filter(Boolean).join(', ')],
    ] : [
      [label('expectedPrice'), form.price && `${rupees(form.price)}${form.priceNegotiable ? ` · ${label('priceNegotiable')}` : ''}`],
      ['', perUnit(form.price, form.carpetArea, priceUnit)],
      [label('ownershipType'), form.ownership],
      [t('listProperty.toggle.homeLoan'), isResidentialType(form.propertyType) && typeof form.loanAvailable === 'boolean'
        ? opt(form.loanAvailable ? 'yes' : 'no') : ''],
      [label('possessionStatus'), !land && opt(POSSESSION_KEYS[form.construction])],
    ] },
    { step: 4, title: t('listProperty.stepNav.photosDocs'), rows: [
      [label('amenities'), form.amenities.length ? t('listProperty.preview.amenityCount', { count: form.amenities.length }) : ''],
      [label('description'), form.description.trim(), true],
      [t('listProperty.bestTime.label'), form.bestTimeToCall ? t(`listProperty.bestTime.${form.bestTimeToCall}`) : ''],
    ] },
  ].map((s) => ({ ...s, rows: s.rows.filter(([, value]) => value) }));
}

export default function ListingPreview({ open, onClose, form, photos, onEdit, onSubmit, busy, submitLabel }) {
  const { t } = useTranslation();
  if (!open) return null;
  const title = headlineOf(form.title, listingLabels(form).title);
  const cover = photos[0]?.url;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('listProperty.preview.title')}
      size="lg"
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-outline px-5 py-3 min-h-[44px] rounded-xl text-gray-300 font-semibold text-sm">
            {t('listProperty.modal.keepEditing')}
          </button>
          <button type="button" onClick={onSubmit} disabled={busy} aria-busy={busy} className="btn-teal px-5 py-3 min-h-[44px] rounded-xl text-white font-semibold text-sm inline-flex items-center gap-2 disabled:opacity-60">
            <CheckCircle2 className="w-4 h-4" /> {submitLabel || t('listProperty.photosDocs.submitProperty')}
          </button>
        </>
      )}
    >
      <div data-testid="listing-preview">
        <div className="relative mb-4 aspect-video overflow-hidden rounded-xl bg-white/5">
          {cover
            ? <img src={cover} alt="" className="h-full w-full object-cover" />
            : <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-400"><ImageOff className="w-5 h-5" /> {t('listProperty.preview.noPhotos')}</div>}
          {photos.length > 0 && (
            <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">
              {t('listProperty.preview.photoCount', { count: photos.length })}
            </span>
          )}
        </div>
        <h3 className="text-lg font-bold text-white">{title}</h3>
        <p className="mb-4 text-xs text-gray-400">{t('listProperty.preview.privacyNote')}</p>
        {sectionsFor(form, t).map((s) => (
          <section key={s.step} className="border-t border-white/10 py-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-teal-300">{s.title}</h4>
              <button type="button" onClick={() => onEdit(s.step)} className="inline-flex min-h-[44px] items-center gap-1.5 px-2 text-xs font-semibold text-gray-300 hover:text-white" aria-label={t('listProperty.preview.editSection', { section: s.title })}>
                <Pencil className="w-3.5 h-3.5" /> {t('listProperty.preview.edit')}
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {s.rows.map(([k, v, clamp]) => (
                <div key={`${k}${v}`} className="contents">
                  <dt className="text-gray-400">{k}</dt>
                  <dd className={clamp ? 'text-gray-100 line-clamp-3 whitespace-pre-line' : 'text-gray-100'}>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
