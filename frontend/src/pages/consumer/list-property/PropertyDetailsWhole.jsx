import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Select from '../../../components/ui/Select';
import MultiSelect from '../../../components/ui/MultiSelect';
import { Pill, FieldError, ToggleRow } from './controls.jsx';
import { fld, lbl, lbl3, ddSolo, unitSuffix } from './styles.js';
import { facingOptions, overlookingOptions, ageOptions, floorOptions, totalFloorsOptions,
  PROPERTY_TYPES, commercialSubtypeOptions, shellOptions, washroomOptions, suitableForFor, fixturesFor,
  commercialSpecsFor, commercialProfileOf, landUnitOptionsFor, areaRangeFor, naStatusOptions,
  otherRightsOptions, buyerEligibilityOptions,
  plotZoneOptions, openSidesOptions, waterSourceOptions } from './constants.js';
import { toDecimal } from './sanitize.js';
import FurnitureIncluded from './FurnitureIncluded.jsx';

const parkingChoices = (tr) => [['0', tr('listProperty.opt.none')], ['1', '1'], ['2', '2'], ['3', '3+']];

export default function PropertyDetailsWhole({ form, set, onPropertyType, onCommercialType, errors, isResidential, isLand, isCommercial, isHouse, toggleInArray, nextStep }) {
  const { t: tr } = useTranslation();
  const isFarm = form.propertyType === 'farmland';
  const areaLabel = isLand() ? (isFarm ? tr('listProperty.fields.landArea') : tr('listProperty.fields.plotAreaLabel')) : tr('listProperty.fields.carpetArea');
  const unitOptions = landUnitOptionsFor(form.propertyType);
  const unitLabel = isLand() ? unitOptions.find(([v]) => v === form.areaUnit)?.[1] : 'sq.ft.';
  // Null until a subtype is chosen — everything keyed on it stays off screen until then.
  const commercialProfile = commercialProfileOf(form.commercialType);
  const parkingOptions = parkingChoices(tr);

  return (
                    <>

                      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div>
                          <label className={lbl3}>{tr('listProperty.fields.propertyType')}</label>
                          <Select
                            value={form.propertyType}
                            onChange={onPropertyType}
                            placeholder={tr('listProperty.ph.selectPropertyType')}
                            dataErr="propertyType"
                            invalid={!!errors.propertyType}
                            options={PROPERTY_TYPES}
                          />
                        </div>

                        {isResidential() && (
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.bhk')}</label>
                            <div className={`flex flex-wrap gap-2.5 ${errors.bhk ? 'dz-invalid-group' : ''}`} data-err="bhk">
                              {['0', '1', '2', '3', '4', '5'].map((n) => (
                                <Pill key={n} selected={form.bhk === n} onClick={() => set('bhk', n)} className="px-5 py-2.5">{n === '0' ? tr('listProperty.opt.oneRk') : n === '5' ? '5+' : n}</Pill>
                              ))}
                            </div>
                            <FieldError show={!!errors.bhk}>{tr('listProperty.err.bhk')}</FieldError>
                          </div>
                        )}

                        {/* Commercial sub-type — required second choice so a shop and a warehouse never share one
                           bucket. */}
                        {isCommercial() && (
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.commercialType')}</label>
                            <Select
                              value={form.commercialType}
                              onChange={onCommercialType}
                              placeholder={tr('listProperty.ph.selectCommercialType')}
                              dataErr="commercialType"
                              invalid={!!errors.commercialType}
                              options={commercialSubtypeOptions(form.commercialType)}
                            />
                            <FieldError show={!!errors.commercialType}>{tr('listProperty.err.commercialType')}</FieldError>
                          </div>
                        )}
                      </div>

                      {isResidential() && (
                        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.bathrooms')}</label>
                            <div className={`flex flex-wrap gap-2.5 ${errors.bathrooms ? 'dz-invalid-group' : ''}`} data-err="bathrooms">
                              {['1', '2', '3', '4'].map((n) => (
                                <Pill key={n} selected={form.bathrooms === n} onClick={() => set('bathrooms', n)} className="px-5 py-2.5">{n === '4' ? '4+' : n}</Pill>
                              ))}
                            </div>
                            <FieldError show={!!errors.bathrooms}>{tr('listProperty.err.bathrooms')}</FieldError>
                          </div>
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.balconies')}</label>
                            <div className="flex flex-wrap gap-2.5">
                              {[['0', tr('listProperty.opt.none')], ['1', '1'], ['2', '2'], ['3', '3+']].map(([v, l]) => (
                                <Pill key={v} selected={form.balconies === v} onClick={() => set('balconies', v)} className="px-5 py-2.5">{l}</Pill>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {isResidential() && (
                        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.parkingSpaces')}</label>
                            <div className="flex flex-wrap gap-2.5">
                              {parkingOptions.map(([v, l]) => (
                                <Pill key={v} selected={form.parkingSpaces === v} onClick={() => set('parkingSpaces', v)} className="px-5 py-2.5">{l}</Pill>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="mb-6 grid grid-cols-2 gap-4">
                        <div>
                          <label className={lbl3}>{areaLabel} *</label>
                          <div className="relative">
                            <input inputMode="decimal" maxLength={9} value={form.carpetArea} onChange={(e) => set('carpetArea', toDecimal(e.target.value))} data-err="carpetArea"
                              placeholder={tr('listProperty.ph.eg1050')} className={`${fld} pr-14 ${errors.carpetArea ? 'dz-invalid' : ''}`} />

                            <div className={unitSuffix}>{unitLabel}</div>
                          </div>
                          <FieldError show={!!errors.carpetArea}>
                            {isLand()
                              ? tr('listProperty.err.areaRange', {
                                label: areaLabel.toLowerCase(),
                                min: areaRangeFor(form.propertyType, form.areaUnit)[0],
                                max: areaRangeFor(form.propertyType, form.areaUnit)[1],
                                unit: unitLabel || '',
                              })
                              : isResidential()
                                ? tr('listProperty.err.areaRange', { label: areaLabel.toLowerCase(), min: '100', max: '20,000', unit: 'sq.ft.' })
                                : tr('listProperty.err.enterArea', { label: areaLabel.toLowerCase() })}
                          </FieldError>
                        </div>
                        {isLand() ? (
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.areaUnit')}</label>
                            <Select value={form.areaUnit} onChange={(v) => set('areaUnit', v)} placeholder={tr('listProperty.ph.selectUnit')}
                              options={unitOptions.map(([value, label]) => ({ value, label }))} />
                          </div>
                        ) : isCommercial() ? null : (
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.builtUpArea')}</label>
                            <div className="relative">
                              <input inputMode="decimal" maxLength={9} value={form.builtUp} onChange={(e) => set('builtUp', toDecimal(e.target.value))}
                                data-err="builtUp" placeholder={tr('listProperty.ph.eg1200')} className={`${fld} pr-12 ${errors.builtUp ? 'dz-invalid' : ''}`} />
                              <div className={unitSuffix}>sq.ft.</div>
                            </div>
                            <FieldError show={!!errors.builtUp}>{tr('listProperty.err.builtUpMin')}</FieldError>
                          </div>
                        )}
                      </div>

                      {/* Optional, because only a builder-sold flat has one. */}
                      {!isLand() && !isCommercial() && (
                        <div className="mb-6">
                          <label className={lbl3}>{tr('listProperty.fields.superBuiltUpArea')}</label>
                          <div className="relative">
                            <input inputMode="decimal" maxLength={9} value={form.superBuiltUp} onChange={(e) => set('superBuiltUp', toDecimal(e.target.value))}
                              data-err="superBuiltUp" placeholder={tr('listProperty.ph.eg1400')} className={`${fld} pr-12 ${errors.superBuiltUp ? 'dz-invalid' : ''}`} />
                            <div className={unitSuffix}>sq.ft.</div>
                          </div>
                          <FieldError show={!!errors.superBuiltUp}>{tr('listProperty.err.superBuiltUpMin')}</FieldError>
                        </div>
                      )}

                      {isHouse() && (
                        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.plotArea')}</label>
                            <div className="relative">
                              <input inputMode="decimal" maxLength={9} value={form.plotArea} onChange={(e) => set('plotArea', toDecimal(e.target.value))}
                                placeholder={tr('listProperty.ph.eg2400')} className={`${fld} pr-12`} />
                              <div className={unitSuffix}>sq.ft.</div>
                            </div>
                          </div>
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.floorsInHouse')}</label>
                            <div className="flex flex-wrap gap-2.5">
                              {[['1', tr('listProperty.opt.ground')], ['2', 'G+1'], ['3', 'G+2'], ['4', 'G+3+']].map(([v, l]) => (
                                <Pill key={v} selected={form.floorsInHouse === v} onClick={() => set('floorsInHouse', v)} className="px-5 py-2.5">{l}</Pill>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {(form.propertyType === 'flat' || isCommercial()) && (
                        <div className="mb-6 grid grid-cols-2 gap-4">
                          <div>
                            <label className={lbl3}>{isCommercial() ? tr('listProperty.fields.floorNo') : tr('listProperty.fields.floorNoReq')}</label>
                            <Select value={form.floor} onChange={(v) => set('floor', v)} placeholder={tr('listProperty.ph.select')} searchable options={floorOptions} dataErr="floor" invalid={!!errors.floor} />
                            <FieldError show={!!errors.floor}>{tr('listProperty.err.floor')}</FieldError>
                          </div>
                          <div>
                            <label className={lbl3}>{isCommercial() ? tr('listProperty.fields.totalFloors') : tr('listProperty.fields.totalFloorsReq')}</label>
                            <Select value={form.totalFloors} onChange={(v) => set('totalFloors', v)} placeholder={tr('listProperty.ph.select')} searchable options={totalFloorsOptions} dataErr="totalFloors" invalid={!!errors.totalFloors} />
                            <FieldError show={!!errors.totalFloors}>{tr('listProperty.err.totalFloors')}</FieldError>
                          </div>
                        </div>
                      )}

                      <div className="mb-6 grid grid-cols-2 gap-4">
                        <div>
                          <label className={lbl3}>{tr('listProperty.fields.facing')}</label>

                          {/* Disable auto-search so more options cannot summon a mobile keyboard. */}
                          <Select value={form.facing} onChange={(v) => set('facing', v)} ariaLabel={tr('listProperty.fields.facing')} placeholder={tr('listProperty.ph.selectFacing')} searchable={false} options={facingOptions} />
                        </div>
                        {!isLand() && (
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.overlooking')}</label>
                            <Select value={form.overlooking} onChange={(v) => set('overlooking', v)} ariaLabel={tr('listProperty.fields.overlooking')} placeholder={tr('listProperty.ph.selectOverlooking')} searchable={false} options={overlookingOptions} />
                          </div>
                        )}

                        {!isLand() && !isCommercial() && (
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.ageOfProperty')}</label>
                            <Select value={form.age} onChange={(v) => set('age', v)} placeholder={tr('listProperty.ph.selectAge')} options={ageOptions} />
                          </div>
                        )}
                      </div>

                      {isResidential() && (
                        <div className="mb-6">
                          <label className={lbl3}>{tr('listProperty.fields.furnishingStatus')}</label>
                          <div className="flex flex-wrap gap-1.5 sm:gap-3">
                            {[['unfurnished', tr('listProperty.opt.unfurnished')], ['semi', tr('listProperty.opt.semiFurnished')], ['furnished', tr('listProperty.opt.furnished')]].map(([v, l]) => (
                              <Pill key={v} selected={form.furnishing === v} onClick={() => set('furnishing', v)} className="grow shrink-0 whitespace-nowrap px-2 py-3 text-center sm:grow-0 sm:px-6">{l}</Pill>
                            ))}
                          </div>
                        </div>
                      )}

                      {isResidential() && <FurnitureIncluded form={form} toggleInArray={toggleInArray} whatKey="listProperty.word.property" />}

                      {isCommercial() && (
                        <>
                          <div className="mb-6">
                            <label className={lbl3}>{tr('listProperty.fields.fitOutStatusReq')}</label>
                            <div className="flex flex-wrap gap-3" data-err="shellType">
                              {shellOptions.map(([v, l]) => (
                                <Pill key={v} selected={form.shellType === v} onClick={() => set('shellType', v)} className={`px-6 py-3 ${errors.shellType ? 'dz-invalid' : ''}`}>{l}</Pill>
                              ))}
                            </div>
                            <FieldError show={!!errors.shellType}>{tr('listProperty.err.shellType')}</FieldError>
                          </div>

                          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div>
                              <label className={lbl3}>{tr('listProperty.fields.washrooms')}</label>
                              <div className="flex flex-wrap gap-2.5">
                                {washroomOptions.map((n) => (
                                  <Pill key={n} selected={form.washrooms === n} onClick={() => set('washrooms', n)} className="px-5 py-2.5">{n}</Pill>
                                ))}
                              </div>
                            </div>
                            <div>
                              <label className={lbl3}>{tr('listProperty.fields.parkingSpaces')}</label>
                              <div className="flex flex-wrap gap-2.5">
                                {parkingOptions.map(([v, l]) => (
                                  <Pill key={v} selected={form.parkingSpaces === v} onClick={() => set('parkingSpaces', v)} className="px-5 py-2.5">{l}</Pill>
                                ))}
                              </div>
                            </div>
                          </div>

                          {commercialProfile && (
                            <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6 items-end">
                              <div>
                                <label className={`${lbl} mb-1`}>{tr('listProperty.fields.suitableFor')}</label>
                                <p className="text-gray-600 text-xs mb-3">{tr('listProperty.help.suitableForHelp')}</p>
                                <MultiSelect
                                  values={form.suitableFor || []}
                                  onChange={(v) => set('suitableFor', v)}
                                  placeholder={tr('listProperty.ph.selectSuitable')}
                                  ariaLabel={tr('listProperty.aria.suitableFor')}
                                  options={suitableForFor(form.commercialType)}
                                />
                              </div>
                              {commercialSpecsFor(form.commercialType).map(({ key, unit, ph, max }) => (
                                <div key={key}>
                                  <label className={lbl3}>{tr(`listProperty.fields.${key}`)}</label>
                                  <div className="relative">
                                    <input inputMode="decimal" maxLength={max} value={form[key]} onChange={(e) => set(key, toDecimal(e.target.value))}
                                      data-err={key} placeholder={tr(`listProperty.ph.${ph}`)} className={`${fld} ${unit ? 'pr-16' : ''}`} />
                                    {unit ? <div className={unitSuffix}>{unit}</div> : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {commercialProfile === 'workspace' && (
                            <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <ToggleRow title={tr('listProperty.toggle.pantry')} subtitle={tr('listProperty.toggle.pantrySub')} on={form.pantry} onClick={() => set('pantry', !form.pantry)} />
                            </div>
                          )}

                          {commercialProfile && (
                            <div className="mb-6">
                              <label className={`${lbl} mb-1`}>{tr('listProperty.fields.fixtures')}</label>
                              <p className="text-gray-600 text-xs mb-3">{tr('listProperty.help.fixturesHelp')}</p>
                              <MultiSelect
                                values={form.fixtures || []}
                                onChange={(v) => set('fixtures', v)}
                                placeholder={tr('listProperty.ph.selectFixtures')}
                                ariaLabel={tr('listProperty.aria.fixtures')}
                                options={fixturesFor(form.commercialType)}
                              />
                            </div>
                          )}
                        </>
                      )}

                      {isLand() && (
                        <>

                          {!isFarm && (
                            <div className="mb-6 grid grid-cols-2 gap-4">
                              <div>
                                <label className={lbl3}>{tr('listProperty.fields.plotLength')}</label>
                                <div className="relative">
                                  <input inputMode="decimal" maxLength={6} value={form.plotLength} onChange={(e) => set('plotLength', toDecimal(e.target.value))}
                                    placeholder={tr('listProperty.ph.eg60')} className={`${fld} pr-8`} />
                                  <div className={unitSuffix}>ft</div>
                                </div>
                              </div>
                              <div>
                                <label className={lbl3}>{tr('listProperty.fields.plotWidth')}</label>
                                <div className="relative">
                                  <input inputMode="decimal" maxLength={6} value={form.plotWidth} onChange={(e) => set('plotWidth', toDecimal(e.target.value))}
                                    placeholder={tr('listProperty.ph.eg40')} className={`${fld} pr-8`} />
                                  <div className={unitSuffix}>ft</div>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div>
                              <label className={lbl3}>{tr('listProperty.fields.approachRoadWidth')}</label>
                              <div className="relative">
                                <input inputMode="decimal" maxLength={6} value={form.roadWidth} onChange={(e) => set('roadWidth', toDecimal(e.target.value))}
                                  placeholder={tr('listProperty.ph.eg30')} className={`${fld} pr-8`} />
                                <div className={unitSuffix}>ft</div>
                              </div>
                            </div>
                            {!isFarm && (
                              <div>
                                <label className={lbl3}>{tr('listProperty.fields.openSides')}</label>
                                <div className="flex flex-wrap gap-2.5">
                                  {openSidesOptions.map((n) => (
                                    <Pill key={n} selected={form.openSides === n} onClick={() => set('openSides', n)} className="px-5 py-2.5">{n}</Pill>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {!isFarm && (
                            <div className="mb-6">
                              <label className={lbl3}>{tr('listProperty.fields.zoning')}</label>
                              <Select className={ddSolo} value={form.plotZone} onChange={(v) => set('plotZone', v)} placeholder={tr('listProperty.ph.selectZone')} options={plotZoneOptions} />
                            </div>
                          )}

                          {isFarm && (
                            <div className="mb-6">
                              <label className={lbl3}>{tr('listProperty.fields.waterSource')}</label>
                              <Select className={ddSolo} value={form.waterSource} onChange={(v) => set('waterSource', v)} placeholder={tr('listProperty.ph.selectWaterSource')} options={waterSourceOptions} />
                            </div>
                          )}

                          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div>
                              <label className={lbl3}>{tr('listProperty.fields.naStatus')}</label>
                              <Select value={form.naStatus} onChange={(v) => set('naStatus', v)} placeholder={tr('listProperty.ph.selectNaStatus')} options={naStatusOptions} dataErr="naStatus" invalid={!!errors.naStatus} />
                              <FieldError show={!!errors.naStatus}>{tr('listProperty.err.naStatus')}</FieldError>
                            </div>
                            <div>
                              <label className={lbl3}>{tr('listProperty.fields.otherRights')}</label>
                              <Select value={form.otherRights} onChange={(v) => set('otherRights', v)} placeholder={tr('listProperty.ph.selectOtherRights')} options={otherRightsOptions} dataErr="otherRights" invalid={!!errors.otherRights} />
                              <FieldError show={!!errors.otherRights}>{tr('listProperty.err.otherRights')}</FieldError>
                            </div>
                          </div>

                          {isFarm && form.deal === 'buy' && (
                            <div className="mb-6">
                              <label className={lbl3}>{tr('listProperty.fields.buyerEligibility')}</label>
                              <Select className={ddSolo} value={form.buyerEligibility} onChange={(v) => set('buyerEligibility', v)} placeholder={tr('listProperty.ph.selectBuyerEligibility')} options={buyerEligibilityOptions} dataErr="buyerEligibility" invalid={!!errors.buyerEligibility} />
                              <FieldError show={!!errors.buyerEligibility}>{tr('listProperty.err.buyerEligibility')}</FieldError>
                              <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
                                <p className="text-amber-200 text-xs font-semibold mb-2">{tr('listProperty.land.saleRestrictionsTitle')}</p>
                                <ul className="text-gray-300 text-xs leading-relaxed list-disc pl-4 space-y-1.5">
                                  <li>{tr('listProperty.land.restrictionAgriculturist')}</li>
                                  <li>{tr('listProperty.land.restrictionTribal')}</li>
                                  <li>{tr('listProperty.land.restrictionCeiling')}</li>
                                  <li>{tr('listProperty.land.restrictionFragmentation')}</li>
                                </ul>
                              </div>
                            </div>
                          )}

                          {isFarm && form.deal === 'rent' && (
                            <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
                              <p className="text-amber-200 text-xs font-semibold mb-2">{tr('listProperty.land.tenancyRiskTitle')}</p>
                              <p className="text-gray-300 text-xs leading-relaxed">{tr('listProperty.land.tenancyRiskBody')}</p>
                            </div>
                          )}

                          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <ToggleRow title={tr('listProperty.toggle.cornerPlot')} subtitle={tr('listProperty.toggle.cornerPlotSub')} on={form.cornerPlot} onClick={() => set('cornerPlot', !form.cornerPlot)} />
                            <ToggleRow title={tr('listProperty.toggle.boundaryWall')} subtitle={tr('listProperty.toggle.boundaryWallSub')} on={form.boundaryWall} onClick={() => set('boundaryWall', !form.boundaryWall)} />
                            {isFarm && (
                              <>
                                <ToggleRow title={tr('listProperty.toggle.electricity')} subtitle={tr('listProperty.toggle.electricitySub')} on={form.electricity} onClick={() => set('electricity', !form.electricity)} />
                                <ToggleRow title={tr('listProperty.toggle.roadAccess')} subtitle={tr('listProperty.toggle.roadAccessSub')} on={form.roadAccess} onClick={() => set('roadAccess', !form.roadAccess)} />
                              </>
                            )}
                          </div>
                        </>
                      )}

                      <div className="flex justify-end lp-step-actions">
                        <button onClick={nextStep} className="btn-teal px-8 py-3.5 min-h-[44px] rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20">
                          {tr('listProperty.next')} <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </>
  );
}
