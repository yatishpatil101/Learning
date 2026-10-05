import { useState } from 'react';
import { ArrowLeft, ArrowRight, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Select from '../../../components/ui/Select';
import DateField from '../../../components/ui/DateField';
import { Pill, Toggle, FieldError } from './controls.jsx';
import StepHeader from './StepHeader.jsx';
import { fld, lbl, lbl3 } from './styles.js';
import { moneyWords, perUnit } from './format.js';
import { toDecimal } from './sanitize.js';
import { todayIso } from '../../../lib/visitWhen.js';
import { ownershipOptions, commercialOwnershipOptions, agreementOptions, lockinOptions, noticeOptions,
  commercialAgreementOptions, commercialLockinOptions, commercialNoticeOptions,
  landAgreementOptions, landLockinOptions, landNoticeOptions,
  leaseKindOf, fitOutOptions, tenancyStatusOptions, DEPOSIT_MONTHS } from './constants.js';
import { isPlotSale, reraRequired as needsReraId } from './validation.js';

const STANDARD_TERMS = { agreementDuration: '11', lockIn: '0', noticePeriod: '1' };
const fallbackUnitLabel = (unit) => ({
  sqft: 'sq.ft', sqm: 'sq.m', sqyd: 'sq.yd', guntha: 'guntha', acre: 'acre', hectare: 'hectare',
}[unit] || 'sq.ft');
const toTwoDecimal = (value) => {
  const [whole, fraction] = toDecimal(value).split('.');
  return fraction == null ? whole.slice(0, 9) : `${whole.slice(0, 9)}.${fraction.slice(0, 2)}`;
};

/* Three lease vocabularies, because the three are let on different cycles: a flat on the 11-month tenancy, a shop or
   shed on year-scale terms, a plot or farm by the year or the crop. */
const LEASE_TERMS = {
  residential: [agreementOptions, lockinOptions, noticeOptions],
  commercial: [commercialAgreementOptions, commercialLockinOptions, commercialNoticeOptions],
  land: [landAgreementOptions, landLockinOptions, landNoticeOptions],
};

const CamCharges = ({ t, form, set }) => (
  <div>
    <label className={lbl3}>{t('listProperty.fields.maintenanceCam')}</label>
    <input inputMode="decimal" maxLength={12} value={form.camCharges} onChange={(e) => set('camCharges', toTwoDecimal(e.target.value))}
      placeholder={t('listProperty.ph.eg12')} className={fld} />
    <p className="text-gray-500 text-xs mt-1.5">{t('listProperty.help.camPerSqft')}</p>
  </div>
);

const PricingStep = ({
  form, set, errors, isLand, isCommercial, money,
  setDepositMonths, toggleTenant, prevStep, nextStep, onReset,
}) => {
  const { t } = useTranslation();
  const [termsOpen, setTermsOpen] = useState(false);
  const land = isLand();
  const commercial = isCommercial();
  const plotSale = isPlotSale(form);
  const residentialPricing = !land && !commercial;
  /* Land is excluded to match the validator: a plot keeps whatever `construction` a flat left behind, and without the
     guard the RERA field would claim a requirement the step never enforces. */
  const preCompletion = !land && (form.construction === 'new' || form.construction === 'under');
  const leaseKind = leaseKindOf(form.propertyType);
  const [agreementOpts, lockinOpts, noticeOpts] = LEASE_TERMS[leaseKind];
  const standardTerms = leaseKind === 'residential'
    && Object.entries(STANDARD_TERMS).every(([field, value]) => form[field] === value);
  const showTerms = termsOpen || !standardTerms;
  const saleUnitLabel = land ? t(`listProperty.unit.${form.areaUnit}`, { defaultValue: fallbackUnitLabel(form.areaUnit) }) : 'sq.ft';
  const saleUnitCaption = form.deal === 'buy' ? perUnit(form.price, form.carpetArea, saleUnitLabel) : '';
  const commercialRentCaption = form.deal === 'rent' && commercial
    ? perUnit(form.monthlyRent, form.carpetArea, `sq.ft ${t('listProperty.unit.perMonthSpaced')}`)
    : '';
  const reraRequired = needsReraId(form);
  const priceWords = moneyWords(form.price);
  const rentWords = moneyWords(form.monthlyRent);

  return (
    <div className="lp-step">
      <StepHeader title={t('listProperty.steps.pricingTitle')} subtitle={t('listProperty.steps.pricingSubtitle')} onReset={onReset} />

      {form.deal === 'buy' && (
        <>

          <div className="mb-4 grid grid-cols-[7fr_3fr] gap-3 items-start">
            <div className="min-w-0">
              <label className={lbl3}>{t('listProperty.fields.expectedPrice')}</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
                <input inputMode="numeric" maxLength={12} {...money('price')} data-err="price" placeholder={t('listProperty.ph.egPrice')} className={`${fld} pl-10 pr-4 ${errors.price ? 'dz-invalid' : ''}`} />
              </div>
              <FieldError show={!!errors.price}>{errors.price === 'min' ? t('listProperty.err.priceMin') : t('listProperty.err.price')}</FieldError>

              {(priceWords || saleUnitCaption) && (
                <p className="mt-1.5 ml-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                  {priceWords && <span className="text-gray-600">{priceWords}</span>}
                  {saleUnitCaption && <span className="text-teal-300/80">{saleUnitCaption}</span>}
                </p>
              )}
            </div>
            <div className="min-w-0">
              <label className={`${lbl3} truncate`} title={t('listProperty.fields.priceNegotiable')}>{t('listProperty.fields.priceNegotiable')}</label>
              <div className="flex items-center justify-center h-[var(--control-h)] rounded-xl bg-white/[0.03] border border-white/5">
                <Toggle on={form.priceNegotiable} onClick={() => set('priceNegotiable', !form.priceNegotiable)} ariaLabel={t('listProperty.fields.priceNegotiable')} />
              </div>
            </div>
          </div>

          {/* A commercial unit states the same recurring cost as CAM, per sq.ft., so the two share one slot — either
             box alone, never both, or they'd be two answers to one question. */}
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!land && !commercial && (
              <div>
                <label className={lbl3}>{t('listProperty.fields.monthlyMaintenance')} <span className="text-gray-500 font-normal">{t('listProperty.optional')}</span></label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
                  <input inputMode="numeric" maxLength={7} {...money('monthlyMaintenance')} placeholder={t('listProperty.ph.egMaint3500')} className={`${fld} pl-10 pr-16`} />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{t('listProperty.unit.perMonth')}</div>
                </div>
              </div>
            )}
            {commercial && <CamCharges t={t} form={form} set={set} />}
            <div>
              <label className={lbl3}>{t('listProperty.fields.ownershipType')}</label>
              <Select value={form.ownership} onChange={(v) => set('ownership', v)} placeholder={t('listProperty.ph.selectOwnership')} options={commercial ? commercialOwnershipOptions : ownershipOptions} dataErr="ownership" invalid={!!errors.ownership} />
              <FieldError show={!!errors.ownership}>{t('listProperty.err.ownership')}</FieldError>
            </div>
          </div>

          {commercial && (
            <div className="mb-6 p-4 sm:p-5 rounded-xl bg-white/[0.03] border border-white/5">
              <label className={lbl}>{t('listProperty.fields.tenancyStatus')}</label>
              <p className="text-gray-500 text-xs mb-3">{t('listProperty.help.tenancyStatus')}</p>
              <div className="flex flex-wrap gap-2.5" data-err="tenancyStatus">
                {tenancyStatusOptions.map(([v, l]) => (
                  <Pill key={v} selected={form.tenancyStatus === v} onClick={() => set('tenancyStatus', form.tenancyStatus === v ? '' : v)} className="px-5 py-2.5">{l}</Pill>
                ))}
              </div>
              {form.tenancyStatus === 'leased' && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={lbl3}>{t('listProperty.fields.inPlaceRent')}</label>
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
                      <input inputMode="numeric" maxLength={9} {...money('inPlaceRent')} data-err="inPlaceRent" placeholder={t('listProperty.ph.egRent32')} className={`${fld} pl-10 pr-16`} />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{t('listProperty.unit.perMonth')}</div>
                    </div>
                  </div>
                  <div>
                    <label className={lbl3}>{t('listProperty.fields.leaseExpiry')}</label>
                    <DateField value={form.leaseExpiry} onChange={(v) => set('leaseExpiry', v)} min={todayIso()} dataErr="leaseExpiry" ariaLabel={t('listProperty.fields.leaseExpiry')} className={fld} />
                  </div>
                </div>
              )}
            </div>
          )}

          {!land && (
            <div className="mb-6 p-4 sm:p-5 rounded-xl bg-white/[0.03] border border-white/5">
              <label className={lbl}>{t('listProperty.fields.possessionStatus')}</label>
              <p className="text-gray-500 text-xs mb-3">{commercial ? t('listProperty.help.possessionCommercial') : t('listProperty.help.possession')}</p>
              <div data-err="possession">
                <div className="grid grid-cols-2 gap-2.5">
                  {[['ready', t('listProperty.opt.readyToMove')], ['new', t('listProperty.opt.newLaunch')], ['under', t('listProperty.opt.underConstruction')]].map(([v, l]) => (
                    <Pill key={v} selected={form.construction === v} onClick={() => set('construction', v)} className="py-2.5 text-center">{l}</Pill>
                  ))}
                </div>
                <FieldError show={!!errors.possession}>{t('listProperty.err.possession')}</FieldError>
                {preCompletion && (
                  <>
                    <DateField value={form.availableFrom} onChange={(v) => set('availableFrom', v)} min={todayIso()} dataErr="availableFrom" ariaLabel={t('listProperty.aria.availableFrom')} invalid={!!errors.availableFrom} className={`${fld} mt-2.5`} />
                    <FieldError show={!!errors.availableFrom}>{t('listProperty.err.availableFromDate')}</FieldError>
                  </>
                )}
              </div>
            </div>
          )}

          {plotSale && (
            <div className="mb-6 p-4 sm:p-5 rounded-xl bg-white/[0.03] border border-white/5">
              <label className={lbl}>{t('listProperty.reraPlots.question')}</label>
              <p className="text-gray-500 text-xs mb-3">{t('listProperty.reraPlots.help')}</p>
              <div className="flex flex-wrap gap-2.5" data-err="plottedProject">
                {['yes', 'no'].map((v) => (
                  <Pill key={v} selected={form.plottedProject === v} onClick={() => set('plottedProject', v)} className="px-5 py-2.5">
                    {t(`listProperty.opt.${v}`)}
                  </Pill>
                ))}
              </div>
              <FieldError show={!!errors.plottedProject}>{t('listProperty.reraPlots.err')}</FieldError>
            </div>
          )}

          {/* MahaRERA sits with the answer that decides whether it is owed, not at the bottom of the document step. */}
          {form.propertyType !== 'farmland' && (
            <div className="mb-6">
              <label htmlFor="lp-rera" className={lbl3}>
                {t('listProperty.fields.reraNo')}
                {!reraRequired && <span className="text-gray-500 font-normal"> {t('listProperty.optional')}</span>}
              </label>
              <input
                id="lp-rera"
                value={form.reraId}
                maxLength={30}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => set('reraId', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
                data-err="reraId"
                placeholder={t('listProperty.ph.reraExample')}
                className={`${fld} sm:max-w-sm ${errors.reraId ? 'dz-invalid' : ''}`}
              />
              <FieldError show={!!errors.reraId}>
                {errors.reraId === 'format' ? t('listProperty.err.reraFormat') : t('listProperty.err.reraRequired')}
              </FieldError>
              <p className="text-gray-500 text-xs mt-1.5">{reraRequired ? t('listProperty.help.reraRequired') : t('listProperty.help.reraHelp')}</p>
            </div>
          )}

          {residentialPricing && (
          <div className="mb-8">
            <label className={lbl3}>{t('listProperty.toggle.homeLoan')}</label>
            <p className="text-gray-500 text-xs mb-3">{t('listProperty.toggle.homeLoanSub')}</p>
            <div className="flex flex-wrap gap-2.5" data-err="loanAvailable">
              {[[true, t('listProperty.opt.yes')], [false, t('listProperty.opt.no')]].map(([v, l]) => (
                <Pill key={String(v)} selected={form.loanAvailable === v} onClick={() => set('loanAvailable', form.loanAvailable === v ? '' : v)} className="px-5 py-2.5">{l}</Pill>
              ))}
            </div>
          </div>
          )}
        </>
      )}

      {form.deal === 'rent' && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className={lbl3}>{t('listProperty.fields.monthlyRent')}</label>
              <div className="relative">
                <div className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
                <input inputMode="numeric" maxLength={9} {...money('monthlyRent')} data-err="monthlyRent" placeholder={t('listProperty.ph.egRent32')} className={`${fld} pl-8 sm:pl-10 pr-14 sm:pr-16 ${errors.monthlyRent ? 'dz-invalid' : ''}`} />
                <div className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{t('listProperty.unit.perMonth')}</div>
              </div>
              <FieldError show={!!errors.monthlyRent}>{errors.monthlyRent === 'min' ? t('listProperty.err.monthlyRentMin') : t('listProperty.err.monthlyRent')}</FieldError>
              {(rentWords || commercialRentCaption) && (
                <p className="mt-1.5 ml-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                  {rentWords && <span className="text-gray-600 text-[15.6px]">{rentWords}</span>}
                  {commercialRentCaption && <span className="text-teal-300/80">{commercialRentCaption}</span>}
                </p>
              )}
            </div>
            <div>
              <label className={lbl3}>{t('listProperty.fields.securityDepositReq')}</label>
              <div className="relative">
                <div className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
                <input inputMode="numeric" maxLength={9} {...money('deposit')} data-err="deposit" placeholder={t('listProperty.ph.egDeposit1L')} className={`${fld} pl-8 sm:pl-10 pr-3 sm:pr-4 ${errors.deposit ? 'dz-invalid' : ''}`} />
              </div>
              <FieldError show={!!errors.deposit}>{errors.deposit === 'max' ? t('listProperty.err.depositMax') : t('listProperty.err.deposit')}</FieldError>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {DEPOSIT_MONTHS[leaseKind].map((m) => (
                  <button key={m} type="button" onClick={() => setDepositMonths(m)} className="relative inline-flex items-center justify-center min-h-[44px] text-xs px-2 sm:px-2.5 py-1 rounded-full border border-white/10 text-gray-400 hover:border-teal-400/40 hover:text-teal-300 transition-all">{t('listProperty.depositMonths', { count: m })}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">

            {commercial && <CamCharges t={t} form={form} set={set} />}
            {!land && !commercial && (
            <div>
              <label className={lbl3}>{t('listProperty.fields.maintenanceCharges')}</label>
              <div className="flex flex-wrap gap-2.5">
                {[['included', t('listProperty.opt.includedInRent')], ['extra', t('listProperty.opt.chargedExtra')]].map(([v, l]) => (
                  <Pill key={v} selected={form.rentMaintMode === v} onClick={() => set('rentMaintMode', v)} className="px-5 py-2.5">{l}</Pill>
                ))}
              </div>
              {form.rentMaintMode === 'extra' && (
                <div className="relative mt-3">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
                  <input inputMode="numeric" maxLength={7} {...money('rentMaintenance')} placeholder={t('listProperty.ph.egMaint2500')} className={`${fld} pl-10 pr-16`} />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{t('listProperty.unit.perMonth')}</div>
                </div>
              )}
            </div>
            )}
            <div>
              <label className={lbl3}>{t('listProperty.fields.availableFrom')}</label>
              <DateField value={form.availableFrom} onChange={(v) => set('availableFrom', v)} min={todayIso()} dataErr="availableFrom" ariaLabel={t('listProperty.aria.availableFrom')} invalid={!!errors.availableFrom} className={fld} />
              <FieldError show={!!errors.availableFrom}>{t('listProperty.err.availableFromDate')}</FieldError>
            </div>
          </div>

          {residentialPricing && (
          <div className="mb-6">
            <label className={lbl3}>{t('listProperty.fields.preferredTenants')}</label>
            <div className="flex flex-wrap gap-2.5">
              {[['family', t('listProperty.opt.family')], ['bachelors', t('listProperty.opt.bachelors')], ['bachelor-male', t('listProperty.opt.bachelorMale')], ['bachelor-female', t('listProperty.opt.bachelorFemale')], ['company', t('listProperty.opt.companyLease')], ['anyone', t('listProperty.opt.anyone')]].map(([v, l]) => (
                <Pill key={v} selected={form.preferredTenants.includes(v)} onClick={() => toggleTenant(v)} className="px-5 py-2.5">
                  {v === 'family' ? <span className="flex items-center gap-2"><Users className="w-4 h-4" />{l}</span> : l}
                </Pill>
              ))}
            </div>
          </div>
          )}

          <div className="mb-6 rounded-xl bg-white/[0.03] border border-white/5 p-4" data-testid="lp-rental-terms">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={lbl}>{t('listProperty.fields.rentalTerms')}</p>
                {!showTerms && <p className="text-sm text-gray-300 mt-1">{t('listProperty.terms.standard')}</p>}
              </div>

              {/* Only offered while the terms are still standard, because that is the only state with a summary to
                 return to. */}
              {standardTerms && (
                <button type="button" onClick={() => setTermsOpen(!termsOpen)} aria-expanded={termsOpen} aria-controls="lp-rental-terms-fields" aria-label={t('listProperty.terms.changeAria')} className="shrink-0 min-h-[44px] px-3 text-sm font-semibold text-teal-300 hover:text-teal-200 transition-colors">
                  {t('listProperty.terms.change')}
                </button>
              )}
            </div>

            {/* Two columns on a phone: lock-in and notice are read against each other, so stacking them hides the deal. */}
            <div id="lp-rental-terms-fields" className={`mt-3 grid-cols-2 sm:grid-cols-3 gap-4 ${showTerms ? 'grid' : 'hidden'}`}>
              <div className="col-span-2 sm:col-span-1">
                <label className={lbl}>{t('listProperty.fields.agreementDuration')}</label>
                <Select value={form.agreementDuration} onChange={(v) => set('agreementDuration', v)} options={agreementOpts} />
              </div>
              <div>
                <label className={lbl}>{t('listProperty.fields.lockInPeriod')}</label>
                <Select value={form.lockIn} onChange={(v) => set('lockIn', v)} options={lockinOpts} />
              </div>
              <div>
                <label className={lbl}>{t('listProperty.fields.noticePeriod')}</label>
                <Select value={form.noticePeriod} onChange={(v) => set('noticePeriod', v)} options={noticeOpts} />
              </div>
            </div>

            {/* Rent alone does not describe a commercial tenancy: GST is 18% on top of it, the fit-out months are
               rent the tenant never pays, and the escalation is what they will pay in year four. */}
            {commercial && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <label className={lbl}>{t('listProperty.fields.gstOnRent')}</label>
                  <div className="flex flex-wrap gap-2.5" data-err="gstOnRent">
                    {[['yes', t('listProperty.opt.yes')], ['no', t('listProperty.opt.no')]].map(([v, l]) => (
                      <Pill key={v} selected={form.gstOnRent === v} onClick={() => set('gstOnRent', form.gstOnRent === v ? '' : v)} className="px-5 py-2.5">{l}</Pill>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={lbl}>{t('listProperty.fields.fitOutPeriod')}</label>
                  <Select value={form.fitOutMonths} onChange={(v) => set('fitOutMonths', v)} placeholder={t('listProperty.ph.select')} options={fitOutOptions} dataErr="fitOutMonths" />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className={lbl}>{t('listProperty.fields.escalation')}</label>
                  <div className="relative">
                    <input inputMode="decimal" maxLength={4} value={form.escalationPct} onChange={(e) => set('escalationPct', toDecimal(e.target.value))}
                      data-err="escalationPct" placeholder={t('listProperty.ph.eg4')} className={`${fld} pr-8`} />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">%</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {residentialPricing && (
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl3}>{t('listProperty.fields.petsAllowed')}</label>
              <div className="flex flex-wrap gap-3" data-err="petsPolicy">
                {[['yes', t('listProperty.opt.allowed')], ['no', t('listProperty.opt.notAllowed')]].map(([v, l]) => (
                  // Re-clicking clears it: an owner who answered by accident, or who no
                  // longer wants to commit, needs a way back to having said nothing.
                  <Pill key={v} selected={form.petsPolicy === v} onClick={() => set('petsPolicy', form.petsPolicy === v ? '' : v)} className="px-5 py-2.5">{l}</Pill>
                ))}
              </div>
            </div>
            <div>
              <label className={lbl3}>{t('listProperty.fields.foodPreference')}</label>
              <div className="flex flex-wrap gap-3">
                {[['any', t('listProperty.opt.vegAndNonveg')], ['veg', t('listProperty.opt.vegOnlyCap')], ['jain', t('listProperty.opt.jainOnlyCap')]].map(([v, l]) => (
                  <Pill key={v} selected={form.foodPref === v} onClick={() => set('foodPref', v)} className="px-5 py-2.5">{l}</Pill>
                ))}
              </div>
            </div>
          </div>
          )}
        </>
      )}

      <div className="flex justify-between lp-step-actions">
        <button onClick={prevStep} className="btn-outline px-6 py-3.5 min-h-[44px] rounded-xl text-gray-300 font-semibold text-sm flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> {t('listProperty.back')}</button>
        <button onClick={nextStep} className="btn-teal px-8 py-3.5 min-h-[44px] rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20">{t('listProperty.next')} <ArrowRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
};

export default PricingStep;
