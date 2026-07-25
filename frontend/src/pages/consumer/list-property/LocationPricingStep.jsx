import { MapPin, ArrowLeft, ArrowRight, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Select from '../../../components/ui/Select';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import DateField from '../../../components/ui/DateField';
import { Pill, ToggleRow, FieldError } from './controls.jsx';
import LocationPicker from './LocationPicker.jsx';
import AreaSearch from './AreaSearch.jsx';
import StepHeader from './StepHeader.jsx';
import { fld, lbl, lbl3 } from './styles.js';
import { moneyWords, perSqft, formatIndian } from './format.js';
import { cleanText } from './sanitize.js';
import { localities, ownershipOptions, agreementOptions, lockinOptions, noticeOptions, commercialAgreementOptions, commercialLockinOptions, commercialNoticeOptions, isPgType, PG_SHARING_OPTS } from './constants.js';
import SocietySelect from './SocietySelect.jsx';

const LocationPricingStep = ({
  form, set, errors, isLand, isCommercial, money,
  mapSearch, onMapSearchChange, runMapSearch, mapSearchStatus, geoFillStatus, flyTo,
  onLocalityChange, onPinMove, locationSet, onAreaSelect,
  setDepositMonths, toggleTenant, prevStep, nextStep, onReset,
}) => {
  const { t } = useTranslation();
  const land = isLand ? isLand() : false;
  const commercial = isCommercial ? isCommercial() : false;
  const pg = isPgType(form.propertyType);
  // Residential-only pricing (preferred tenants, pets, food, home loan) doesn't
  // apply to land or commercial listings. A PG swaps this cluster for its own
  // PG-for + Meals block, so it opts out of the generic residential controls too.
  const residentialPricing = !land && !commercial;
  const pgResidentialPricing = residentialPricing && !pg;
  // Address terminology adapts to the property type: a shop isn't a "flat", a
  // business park isn't a "society", and a PG is booked by building, not unit.
  // (A PG's building floor count is captured by the "No. of Floors" dropdown on
  // the property-details step, for both the rent & sale workflow.)
  const unitLabel = commercial ? t('listProperty.fields.unitShopNoReq') : pg ? t('listProperty.fields.roomFloorNo') : t('listProperty.fields.flatUnitNoReq');
  const unitPlaceholder = commercial ? t('listProperty.ph.egShopUnit') : pg ? t('listProperty.ph.egRoomFloor') : t('listProperty.ph.egBUnit4');
  const blockLabel = commercial ? t('listProperty.fields.blockTower') : t('listProperty.fields.wingBlock');
  const blockPlaceholder = commercial ? t('listProperty.ph.egBTower') : t('listProperty.ph.egBWing');
  const projectLabel = land ? t('listProperty.fields.projectLayoutName') : commercial ? t('listProperty.fields.buildingComplexNameReq') : pg ? t('listProperty.fields.pgBuildingNameReq') : t('listProperty.fields.buildingSocietyNameReq');
  const projectPlaceholder = land ? t('listProperty.ph.egGreenAcres') : commercial ? t('listProperty.ph.egWtc') : pg ? t('listProperty.ph.egSaiPg') : t('listProperty.ph.egSkyline');
  const projectError = commercial ? t('listProperty.err.projectCommercial') : pg ? t('listProperty.err.projectPg') : t('listProperty.err.society');
  // Commercial leases use longer, year-scale terms.
  const agreementOpts = commercial ? commercialAgreementOptions : agreementOptions;
  const lockinOpts = commercial ? commercialLockinOptions : lockinOptions;
  const noticeOpts = commercial ? commercialNoticeOptions : noticeOptions;
  // ₹/sq.ft only reads true when the area is in sq.ft — land can be priced in
  // acre/guntha, so skip the derived caption unless its unit is sq.ft.
  const showPerSqft = form.deal === 'buy' && (!land || form.areaUnit === 'sqft');
  const perSqftCaption = showPerSqft ? perSqft(form.price, form.carpetArea) : '';

  // PG rent is priced per occupancy: the owner sets a rent for each sharing type
  // they offer. `monthlyRent` (the headline "from" price shown on cards and used
  // by the budget filter) is kept in sync as the cheapest of those, so nothing
  // downstream needs to know about the per-occupancy breakdown.
  const selectedShareOpts = PG_SHARING_OPTS.filter((o) => (form.sharing || []).includes(o.value));
  const setSharingRent = (key, raw) => {
    const nextRents = { ...(form.sharingRents || {}), [key]: raw.replace(/\D/g, '') };
    const vals = Object.values(nextRents).map((v) => parseInt(v, 10)).filter((n) => n > 0);
    set('sharingRents', nextRents);
    set('monthlyRent', vals.length ? String(Math.min(...vals)) : '');
  };
  return (
                <div className="lp-step">
                  <StepHeader title={t('listProperty.steps.locationPricingTitle')} subtitle={t('listProperty.steps.locationPricingSubtitle')} onReset={onReset} />

                  {/* Map first — the owner pins the exact spot, and we reverse-geocode it
                     to pre-fill the address fields below. Placing this ahead of the address
                     grid makes "locate, then confirm the details" the natural flow. */}
                  <div className="mb-6" data-err="location">
                    <label className={`${lbl} mb-1`}>{t('listProperty.fields.pinPropertyLocation')}</label>
                    <p className="text-gray-500 text-xs mb-3">{t('listProperty.help.pinPropertyHint')}</p>
                    <div className="mb-2">
                      <AreaSearch
                        value={mapSearch}
                        onChange={onMapSearchChange}
                        onRunSearch={runMapSearch}
                        onSelectPlace={onAreaSelect}
                        status={mapSearchStatus}
                        placeholder={t('listProperty.ph.areaSearch')}
                      />
                    </div>
                    <div style={{ height: 280, borderRadius: 14, overflow: 'hidden', border: `1px solid ${errors.location ? 'rgba(248,113,113,.6)' : 'rgba(255,255,255,.1)'}` }}>
                      <LocationPicker lat={form.propLat} lng={form.propLng} flyTo={flyTo} onMove={(la, ln) => onPinMove(la, ln)} />
                    </div>
                    {locationSet ? (
                      <p className="text-emerald-300/90 text-xs mt-2 flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-emerald-400" /> {t('listProperty.help.locationSet', { lat: Number(form.propLat).toFixed(4), lng: Number(form.propLng).toFixed(4) })}
                      </p>
                    ) : (
                      <p className="text-gray-500 text-xs mt-2">
                        <MapPin className="w-3 h-3 inline text-teal-400" /> {t('listProperty.help.searchOrDragProperty')}
                      </p>
                    )}
                    {geoFillStatus === 'filling' && <p className="text-gray-500 text-xs mt-1.5">{t('listProperty.help.fillingAddress')}</p>}
                    {geoFillStatus === 'done' && <p className="text-teal-300/80 text-xs mt-1.5 flex items-center gap-1.5"><MapPin className="w-3 h-3 text-teal-400" /> {t('listProperty.help.filledAddress')}</p>}
                    <FieldError show={!!errors.location}>{t('listProperty.err.location')}</FieldError>
                  </div>

                  {/* Address grid — auto-filled from the pin where possible; the owner
                     confirms or completes anything we couldn't resolve. */}
                  <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div><label className={lbl}>{t('listProperty.fields.locality')}</label><LocalitySelect value={form.locality} onChange={(v) => onLocalityChange(v)} onSelect={(sel) => onLocalityChange(sel.name, sel)} placeholder={t('listProperty.ph.selectLocality')} options={localities} dataErr="locality" invalid={!!errors.locality} /><FieldError show={!!errors.locality}>{t('listProperty.err.locality')}</FieldError></div>
                    {!land && <div><label className={lbl}>{unitLabel}</label><input value={form.flatNumber} maxLength={20} onChange={(e) => set('flatNumber', cleanText(e.target.value))} data-err="flatNumber" placeholder={unitPlaceholder} className={`${fld} ${errors.flatNumber ? 'pn-invalid' : ''}`} /><FieldError show={!!errors.flatNumber}>{commercial ? t('listProperty.err.unitShopNumber') : t('listProperty.err.flatNumber')}</FieldError></div>}
                    {!land && <div><label className={lbl}>{blockLabel}</label><input value={form.tower} maxLength={30} onChange={(e) => set('tower', cleanText(e.target.value))} placeholder={blockPlaceholder} className={fld} /></div>}
                    <div><label className={lbl}>{projectLabel}</label>{(!land && !commercial) ? (
                      <SocietySelect value={form.societyId} name={form.society} localityLabel={form.locality} lat={form.propLat} lng={form.propLng} pincode={form.pincode} invalid={!!errors.society} placeholder={projectPlaceholder} onChange={({ id, name }) => { set('societyId', id); set('society', name); }} />
                    ) : (
                      <input value={form.society} maxLength={60} onChange={(e) => set('society', cleanText(e.target.value))} data-err="society" placeholder={projectPlaceholder} className={`${fld} ${errors.society ? 'pn-invalid' : ''}`} />
                    )}<FieldError show={!!errors.society}>{projectError}</FieldError></div>
                    <div><label className={lbl}>{t('listProperty.fields.streetRoad')}</label><input value={form.street} maxLength={60} onChange={(e) => set('street', cleanText(e.target.value))} placeholder={t('listProperty.ph.egBanerRoad')} className={fld} /></div>
                    <div><label className={lbl}>{t('listProperty.fields.landmark')}</label><input value={form.landmark} maxLength={60} onChange={(e) => set('landmark', cleanText(e.target.value))} placeholder={t('listProperty.ph.egDMart')} className={fld} /></div>
                    <div><label className={lbl}>{t('listProperty.fields.pincodeReq')}</label><input inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))} data-err="pincode" placeholder="411045" className={`${fld} ${errors.pincode ? 'pn-invalid' : ''}`} /><FieldError show={!!errors.pincode}>{t('listProperty.err.pincode')}</FieldError></div>
                    {!land && (
                      <div className="sm:col-span-2">
                        <label className={lbl}>{t('listProperty.fields.electricityConsumerNo')} <span className="text-gray-500 font-normal">{t('listProperty.optional')}</span></label>
                        <input inputMode="numeric" maxLength={20} value={form.electricityConsumerNo} onChange={(e) => set('electricityConsumerNo', e.target.value.replace(/\D/g, ''))} placeholder={t('listProperty.ph.egElectricityConsumer')} className={fld} />
                        <p className="text-gray-600 text-xs mt-1.5">{t('listProperty.help.electricityConsumerHelp')}</p>
                      </div>
                    )}
                  </div>

                  {/* SALE pricing */}
                  {form.deal === 'buy' && (
                    <>
                      {/* Expected Price + Price Negotiable share one row, equal size */}
                      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className={lbl3}>{t('listProperty.fields.expectedPrice')}</label>
                          <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
                            <input inputMode="numeric" maxLength={12} {...money('price')} data-err="price" placeholder={t('listProperty.ph.egPrice')} className={`${fld} pl-10 pr-4 ${errors.price ? 'pn-invalid' : ''}`} />
                          </div>
                          <FieldError show={!!errors.price}>{t('listProperty.err.price')}</FieldError>
                          {moneyWords(form.price) && <p className="text-gray-600 text-xs mt-1.5 ml-1">{moneyWords(form.price)}</p>}
                          {perSqftCaption && <p className="text-teal-300/80 text-xs mt-1 ml-1">{perSqftCaption}</p>}
                        </div>
                        <div>
                          {/* Spacer keeps the toggle aligned with the price input, not its label. */}
                          <span className={`${lbl3} invisible`} aria-hidden="true">{t('listProperty.fields.priceNegotiable')}</span>
                          {/* Height matches the price input (--control-h) so it reads as one row. */}
                          <ToggleRow className="h-[var(--control-h)]" pad="px-4 py-0" title={t('listProperty.fields.priceNegotiable')} on={form.priceNegotiable} onClick={() => set('priceNegotiable', !form.priceNegotiable)} />
                        </div>
                      </div>

                      {/* Monthly Maintenance stays with the price cluster; Ownership beside it */}
                      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {!land && (
                          <div>
                            <label className={lbl3}>{t('listProperty.fields.monthlyMaintenance')} <span className="text-gray-500 font-normal">{t('listProperty.optional')}</span></label>
                            <div className="relative">
                              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
                              <input inputMode="numeric" maxLength={7} {...money('monthlyMaintenance')} placeholder={t('listProperty.ph.egMaint3500')} className={`${fld} pl-10 pr-16`} />
                              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{t('listProperty.unit.perMonth')}</div>
                            </div>
                          </div>
                        )}
                        <div>
                          <label className={lbl3}>{t('listProperty.fields.ownershipType')}</label>
                          <Select value={form.ownership} onChange={(v) => set('ownership', v)} placeholder={t('listProperty.ph.selectOwnership')} options={ownershipOptions} dataErr="ownership" invalid={!!errors.ownership} />
                          <FieldError show={!!errors.ownership}>{t('listProperty.err.ownership')}</FieldError>
                        </div>
                      </div>

                      {/* Sale Type + Possession Status — not meaningful for raw land */}
                      {!land && (
                      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
                        <div className="h-full p-4 sm:p-5 rounded-xl bg-white/[0.03] border border-white/5">
                          <label className={lbl}>{t('listProperty.fields.saleType')}</label>
                          <p className="text-gray-500 text-xs mb-3">{commercial ? t('listProperty.help.saleTypeCommercial') : t('listProperty.help.saleType')}</p>
                          <div className="grid grid-cols-2 gap-2.5">
                            {[['new', t('listProperty.opt.newProperty')], ['resale', t('listProperty.opt.resale')]].map(([v, l]) => (
                              <Pill key={v} selected={form.transactionType === v} onClick={() => set('transactionType', v)} className="py-2.5 text-center">{l}</Pill>
                            ))}
                          </div>
                        </div>
                        <div className="h-full p-4 sm:p-5 rounded-xl bg-white/[0.03] border border-white/5">
                          <label className={lbl}>{t('listProperty.fields.possessionStatus')}</label>
                          <p className="text-gray-500 text-xs mb-3">{commercial ? t('listProperty.help.possessionCommercial') : t('listProperty.help.possession')}</p>
                          <div data-err="possession">
                            <div className="grid grid-cols-2 gap-2.5">
                              {[['ready', t('listProperty.opt.readyToMove')], ['available', t('listProperty.opt.availableFrom')]].map(([v, l]) => (
                                <Pill key={v} selected={form.possession === v} onClick={() => set('possession', v)} className="py-2.5 text-center">{l}</Pill>
                              ))}
                            </div>
                            <FieldError show={!!errors.possession}>{t('listProperty.err.possession')}</FieldError>
                            {form.possession === 'available' && (
                              <>
                                <DateField value={form.availableFrom} onChange={(v) => set('availableFrom', v)} dataErr="availableFrom" ariaLabel={t('listProperty.aria.availableFrom')} invalid={!!errors.availableFrom} className={`${fld} mt-2.5`} />
                                <FieldError show={!!errors.availableFrom}>{t('listProperty.err.availableFromDate')}</FieldError>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      )}

                      {residentialPricing && (
                      <div className="mb-8">
                        <ToggleRow title={t('listProperty.toggle.homeLoan')} subtitle={t('listProperty.toggle.homeLoanSub')} on={form.loanAvailable} onClick={() => set('loanAvailable', !form.loanAvailable)} />
                      </div>
                      )}
                    </>
                  )}

                  {/* RENT pricing */}
                  {form.deal === 'rent' && (
                    <>
                      {pg ? (
                        <>
                          <div className="mb-6">
                            <label className={lbl3}>{t('listProperty.fields.rentByOccupancy')}</label>
                            <p className="text-gray-500 text-xs mb-3 -mt-1">{t('listProperty.help.rentByOccupancy')}</p>
                            {selectedShareOpts.length ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-err="monthlyRent">
                                {selectedShareOpts.map((o) => (
                                  <div key={o.value}>
                                    <label className="block text-xs text-gray-400 mb-1.5">{o.label}</label>
                                    <div className="relative">
                                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
                                      <input inputMode="numeric" maxLength={9} value={formatIndian(form.sharingRents?.[o.value])} onChange={(e) => setSharingRent(o.value, e.target.value)} placeholder={t('listProperty.ph.egRent8500')} className={`${fld} pl-10 pr-16 ${errors.monthlyRent ? 'pn-invalid' : ''}`} />
                                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{t('listProperty.unit.perBed')}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-amber-300/80 text-sm bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3">{t('listProperty.help.pickSharingTypes')}</p>
                            )}
                            <FieldError show={!!errors.monthlyRent}>{t('listProperty.err.monthlyRentPg')}</FieldError>
                          </div>
                          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className={lbl3}>{t('listProperty.fields.securityDepositReq')}</label>
                              <div className="relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
                                <input inputMode="numeric" maxLength={9} {...money('deposit')} data-err="deposit" placeholder={t('listProperty.ph.egDeposit20')} className={`${fld} pl-10 pr-4 ${errors.deposit ? 'pn-invalid' : ''}`} />
                              </div>
                              <FieldError show={!!errors.deposit}>{t('listProperty.err.deposit')}</FieldError>
                              <div className="flex flex-wrap gap-2 mt-2">
                                {[1, 2, 3].map((m) => (
                                  <button key={m} type="button" onClick={() => setDepositMonths(m)} className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-gray-400 hover:border-teal-400/40 hover:text-teal-300 transition-all">{t('listProperty.depositMonths', { count: m })}</button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className={lbl3}>{t('listProperty.fields.monthlyRent')}</label>
                          <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
                            <input inputMode="numeric" maxLength={9} {...money('monthlyRent')} data-err="monthlyRent" placeholder={t('listProperty.ph.egRent32')} className={`${fld} pl-10 pr-16 ${errors.monthlyRent ? 'pn-invalid' : ''}`} />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{t('listProperty.unit.perMonth')}</div>
                          </div>
                          <FieldError show={!!errors.monthlyRent}>{t('listProperty.err.monthlyRent')}</FieldError>
                          {moneyWords(form.monthlyRent) && <p className="text-gray-600 text-xs mt-1.5 ml-1">{moneyWords(form.monthlyRent)}</p>}
                        </div>
                        <div>
                          <label className={lbl3}>{t('listProperty.fields.securityDepositReq')}</label>
                          <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</div>
                            <input inputMode="numeric" maxLength={9} {...money('deposit')} data-err="deposit" placeholder={t('listProperty.ph.egDeposit1L')} className={`${fld} pl-10 pr-4 ${errors.deposit ? 'pn-invalid' : ''}`} />
                          </div>
                          <FieldError show={!!errors.deposit}>{t('listProperty.err.deposit')}</FieldError>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {[1, 2, 3, 6].map((m) => (
                              <button key={m} type="button" onClick={() => setDepositMonths(m)} className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-gray-400 hover:border-teal-400/40 hover:text-teal-300 transition-all">{t('listProperty.depositMonths', { count: m })}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                      )}

                      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {!land && (
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
                          <DateField value={form.availableFrom} onChange={(v) => set('availableFrom', v)} dataErr="availableFrom" ariaLabel={t('listProperty.aria.availableFrom')} invalid={!!errors.availableFrom} className={fld} />
                          <FieldError show={!!errors.availableFrom}>{t('listProperty.err.availableFromDate')}</FieldError>
                        </div>
                      </div>

                      {pgResidentialPricing && (
                      <div className="mb-6">
                        <label className={lbl3}>{t('listProperty.fields.preferredTenants')}</label>
                        <div className="flex flex-wrap gap-2.5">
                          {[['family', t('listProperty.opt.family')], ['bachelors', t('listProperty.opt.bachelors')], ['company', t('listProperty.opt.companyLease')], ['anyone', t('listProperty.opt.anyone')]].map(([v, l]) => (
                            <Pill key={v} selected={form.preferredTenants.includes(v)} onClick={() => toggleTenant(v)} className="px-5 py-2.5">
                              {v === 'family' ? <span className="flex items-center gap-2"><Users className="w-4 h-4" />{l}</span> : l}
                            </Pill>
                          ))}
                        </div>
                      </div>
                      )}

                      {/* PG / Hostel: who the PG is for + whether meals are served —
                         the two questions every PG seeker asks first. */}
                      {pg && (
                      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className={lbl3}>{t('listProperty.fields.pgIsFor')}</label>
                          <div className="flex flex-wrap gap-2.5" data-err="pgGender">
                            {[['boys', t('listProperty.opt.boys')], ['girls', t('listProperty.opt.girls')], ['any', t('listProperty.opt.anyone')]].map(([v, l]) => (
                              <Pill key={v} selected={form.pgGender === v} onClick={() => set('pgGender', v)} className="px-5 py-2.5">
                                <span className="flex items-center gap-2"><Users className="w-4 h-4" />{l}</span>
                              </Pill>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className={lbl3}>{t('listProperty.fields.meals')}</label>
                          <div className="flex flex-wrap gap-2.5">
                            {[['none', t('listProperty.opt.noMeals')], ['veg', t('listProperty.opt.veg')], ['both', t('listProperty.opt.vegAndNonveg')]].map(([v, l]) => (
                              <Pill key={v} selected={form.pgMeals === v} onClick={() => set('pgMeals', v)} className="px-5 py-2.5">{l}</Pill>
                            ))}
                          </div>
                        </div>
                      </div>
                      )}

                      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
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

                      {pgResidentialPricing && (
                      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className={lbl3}>{t('listProperty.fields.petsAllowed')}</label>
                          <div className="flex flex-wrap gap-3">
                            {[['yes', t('listProperty.opt.allowed')], ['no', t('listProperty.opt.notAllowed')]].map(([v, l]) => (
                              <Pill key={v} selected={form.petsPolicy === v} onClick={() => set('petsPolicy', v)} className="px-5 py-2.5">{l}</Pill>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className={lbl3}>{t('listProperty.fields.foodPreference')}</label>
                          <div className="flex flex-wrap gap-3">
                            {[['any', t('listProperty.opt.vegAndNonveg')], ['veg', t('listProperty.opt.vegOnlyCap')]].map(([v, l]) => (
                              <Pill key={v} selected={form.foodPref === v} onClick={() => set('foodPref', v)} className="px-5 py-2.5">{l}</Pill>
                            ))}
                          </div>
                        </div>
                      </div>
                      )}
                    </>
                  )}

                  <div className="flex justify-between">
                    <button onClick={prevStep} className="btn-outline px-6 py-3.5 min-h-[44px] rounded-xl text-gray-300 font-semibold text-sm flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> {t('listProperty.back')}</button>
                    <button onClick={nextStep} className="btn-teal px-8 py-3.5 min-h-[44px] rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20">{t('listProperty.next')} <ArrowRight className="w-4 h-4" /></button>
                  </div>
                </div>
  );
};

export default LocationPricingStep;