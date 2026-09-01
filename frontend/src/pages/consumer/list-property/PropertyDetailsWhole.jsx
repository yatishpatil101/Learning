import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Select from '../../../components/ui/Select';
import MultiSelect from '../../../components/ui/MultiSelect';
import FeatureSelector from '../../../components/ui/FeatureSelector';
import { Pill, FieldError, ToggleRow } from './controls.jsx';
import { fld, lbl, lbl3, ddSolo } from './styles.js';
import { facingOptions, ageOptions, floorOptions, totalFloorsOptions, furnitureFor,
  PROPERTY_TYPES, COMMERCIAL_SUBTYPES, shellOptions, washroomOptions, suitableForTags, fixturesFor,
  plotZoneOptions, openSidesOptions, plotUnitOptions, farmUnitOptions, waterSourceOptions,
  PG_SHARING, PG_SHARING_HELP } from './constants.js';
import { toDigits, toDecimal } from './sanitize.js';

export default function PropertyDetailsWhole({ form, set, onPropertyType, errors, isResidential, isLand, isCommercial, isHouse, isPg, toggleInArray, nextStep }) {
  const { t: tr } = useTranslation();
  const isFarm = form.propertyType === 'farmland';
  const pg = isPg ? isPg() : false;
  const areaLabel = isLand() ? (isFarm ? tr('listProperty.fields.landArea') : tr('listProperty.fields.plotAreaLabel')) : pg ? tr('listProperty.fields.roomArea') : tr('listProperty.fields.carpetArea');
  const unitOptions = isFarm ? farmUnitOptions : plotUnitOptions;

  return (
                    <>
                      {/* Property Type + BHK — the two most-defining fields share
                         one row, keeping the dropdown compact instead of stretched.
                         For commercial, the Commercial Type dropdown takes the
                         right column so both selectors read as one balanced row. */}
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

                        {/* BHK — or Sharing for a PG/Hostel, whose rooms are
                           defined by occupancy rather than bedroom count. */}
                        {isResidential() && !pg && (
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.bhk')}</label>
                            <div className={`flex flex-wrap gap-2.5 ${errors.bhk ? 'pn-invalid-group' : ''}`} data-err="bhk">
                              {['1', '2', '3', '4'].map((n) => (
                                <Pill key={n} selected={form.bhk === n} onClick={() => set('bhk', n)} className="px-5 py-2.5">{n === '4' ? '4+' : n}</Pill>
                              ))}
                            </div>
                            <FieldError show={!!errors.bhk}>{tr('listProperty.err.bhk')}</FieldError>
                          </div>
                        )}

                        {/* No. of Floors — a PG/Hostel is a whole building let per
                           bed, so it carries a building floor-count. It shares the
                           Property Type row so neither field is left stretched, and
                           the room-sharing options move to their own pill group below
                           (right above Furnishing). */}
                        {pg && (
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.noOfFloors')}</label>
                            <Select value={form.totalFloors} onChange={(v) => set('totalFloors', v)} placeholder={tr('listProperty.ph.select')} searchable options={totalFloorsOptions} />
                          </div>
                        )}

                        {/* Commercial sub-type — required second choice so a shop and a
                           warehouse never share one bucket. Shares the Property Type
                           row as a compact dropdown; only surfaces for Commercial. */}
                        {isCommercial() && (
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.commercialType')}</label>
                            <Select
                              value={form.commercialType}
                              onChange={(v) => set('commercialType', v)}
                              placeholder={tr('listProperty.ph.selectCommercialType')}
                              dataErr="commercialType"
                              invalid={!!errors.commercialType}
                              options={COMMERCIAL_SUBTYPES}
                            />
                            <FieldError show={!!errors.commercialType}>{tr('listProperty.err.commercialType')}</FieldError>
                          </div>
                        )}
                      </div>

                      {/* Bathrooms & Balconies — a PG room's bathroom is shared or
                         attached, so this isn't asked for PG/Hostel listings. */}
                      {isResidential() && !pg && (
                        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.bathrooms')}</label>
                            <div className={`flex flex-wrap gap-2.5 ${errors.bathrooms ? 'pn-invalid-group' : ''}`} data-err="bathrooms">
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

                      {/* Parking. Asked of a residential lister for the first time in D244: the
                          detail page has always had a Parking tile, but the only control was on the
                          commercial branch, so for every flat in the catalogue it rendered an em
                          dash no matter what the owner would have said. A count and not a yes/no —
                          "is there parking" is answered by the amenity list; the number of slots
                          that come with the unit is the thing a two-car household compares, and it
                          is the one the tile was always asking for. */}
                      {isResidential() && !pg && (
                        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.parkingSpaces')}</label>
                            <div className="flex flex-wrap gap-2.5">
                              {[['0', tr('listProperty.opt.none')], ['1', '1'], ['2', '2'], ['3', '3+']].map(([v, l]) => (
                                <Pill key={v} selected={form.parkingSpaces === v} onClick={() => set('parkingSpaces', v)} className="px-5 py-2.5">{l}</Pill>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Area — for a PG the room has only a carpet area (no built-up),
                         and its floor count now sits up beside Property Type, so Room
                         Area spans the full row instead of leaving a half-empty cell. */}
                      <div className={`mb-6 grid grid-cols-1 gap-4 ${pg ? '' : 'sm:grid-cols-2'}`}>
                        <div>
                          <label className={lbl3}>{areaLabel} *</label>
                          <div className="relative">
                            <input inputMode="decimal" maxLength={9} value={form.carpetArea} onChange={(e) => set('carpetArea', toDecimal(e.target.value))} data-err="carpetArea"
                              placeholder={tr('listProperty.ph.eg1050')} className={`${fld} pr-20 ${errors.carpetArea ? 'pn-invalid' : ''}`} />
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-3 py-1 rounded-lg">
                              {isLand() ? (unitOptions.find(([v]) => v === form.areaUnit)?.[1] || unitOptions[0][1]) : 'sq.ft.'}
                            </div>
                          </div>
                          <FieldError show={!!errors.carpetArea}>{tr('listProperty.err.enterArea', { label: areaLabel.toLowerCase() })}</FieldError>
                        </div>
                        {!pg && (isLand() ? (
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.areaUnit')}</label>
                            <Select value={form.areaUnit} onChange={(v) => set('areaUnit', v)} placeholder={tr('listProperty.ph.selectUnit')}
                              options={unitOptions.map(([value, label]) => ({ value, label }))} />
                          </div>
                        ) : (
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.builtUpArea')}</label>
                            <div className="relative">
                              <input inputMode="decimal" maxLength={9} value={form.builtUp} onChange={(e) => set('builtUp', toDecimal(e.target.value))}
                                placeholder={tr('listProperty.ph.eg1200')} className={`${fld} pr-20`} />
                              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-3 py-1 rounded-lg">sq.ft.</div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Plot area + storeys — houses sit on land they own, so they carry
                         both a carpet area and a plot area, and floor count instead of floor no. */}
                      {isHouse() && (
                        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.plotArea')}</label>
                            <div className="relative">
                              <input inputMode="decimal" maxLength={9} value={form.plotArea} onChange={(e) => set('plotArea', toDecimal(e.target.value))}
                                placeholder={tr('listProperty.ph.eg2400')} className={`${fld} pr-20`} />
                              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-3 py-1 rounded-lg">sq.ft.</div>
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

                      {/* Floor — only built-in-a-tower types (flats, commercial units). */}
                      {(form.propertyType === 'flat' || isCommercial()) && (
                        <div className="mb-6 grid grid-cols-2 gap-4">
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.floorNo')}</label>
                            <Select value={form.floor} onChange={(v) => set('floor', v)} placeholder={tr('listProperty.ph.select')} searchable options={floorOptions} />
                          </div>
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.totalFloors')}</label>
                            <Select value={form.totalFloors} onChange={(v) => set('totalFloors', v)} placeholder={tr('listProperty.ph.select')} searchable options={totalFloorsOptions} />
                          </div>
                        </div>
                      )}

                      {/* Facing & Age — relevant for every built type, not for raw land. */}
                      {!isLand() && (
                        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.facing')}</label>
                            <Select value={form.facing} onChange={(v) => set('facing', v)} placeholder={tr('listProperty.ph.selectFacing')} options={facingOptions} />
                          </div>
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.ageOfProperty')}</label>
                            <Select value={form.age} onChange={(v) => set('age', v)} placeholder={tr('listProperty.ph.selectAge')} options={ageOptions} />
                          </div>
                        </div>
                      )}

                      {/* Sharing Types (PG / Hostel occupancy) — a PG usually offers
                         several room types, each with its own rent on the pricing step.
                         Shown as a multi-select pill group (like Furnishing) so every
                         option an owner can offer is visible at a glance, and placed
                         right above Furnishing Status. */}
                      {pg && (
                        <div className="mb-6">
                          <label className={lbl3}>{tr('listProperty.fields.sharingTypes')}</label>
                          <p className="text-gray-600 text-xs mb-3 leading-relaxed">{PG_SHARING_HELP}</p>
                          <div className={`flex flex-wrap gap-3 ${errors.sharing ? 'pn-invalid-group' : ''}`} data-err="sharing">
                            {PG_SHARING.map(([v, l]) => (
                              <Pill key={v} selected={(form.sharing || []).includes(v)} onClick={() => toggleInArray('sharing', v)} className="px-5 py-2.5">{l}</Pill>
                            ))}
                          </div>
                          <FieldError show={!!errors.sharing}>{tr('listProperty.err.sharing')}</FieldError>
                        </div>
                      )}

                      {/* Furnishing */}
                      {isResidential() && (
                        <div className="mb-6">
                          <label className={lbl3}>{tr('listProperty.fields.furnishingStatus')}</label>
                          <div className="flex flex-wrap gap-3">
                            {[['unfurnished', tr('listProperty.opt.unfurnished')], ['semi', tr('listProperty.opt.semiFurnished')], ['furnished', tr('listProperty.opt.furnished')]].map(([v, l]) => (
                              <Pill key={v} selected={form.furnishing === v} onClick={() => set('furnishing', v)} className="px-6 py-3">{l}</Pill>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Furniture */}
                      {isResidential() && (form.furnishing === 'furnished' || form.furnishing === 'semi') && (
                        <div className="mb-8">
                          <label className={`${lbl} mb-1`}>{tr('listProperty.fields.whatsIncluded')}</label>
                          <p className="text-gray-600 text-xs mb-3">{tr('listProperty.help.furnitureIncluded', { what: pg ? tr('listProperty.word.room') : tr('listProperty.word.property') })}</p>
                          <FeatureSelector
                            options={furnitureFor(form.propertyType)}
                            values={form.furniture}
                            onToggle={(label) => toggleInArray('furniture', label)}
                            placeholder={tr('listProperty.ph.addOtherFurniture')}
                            addAriaLabel={tr('listProperty.aria.furnitureItem')}
                          />
                        </div>
                      )}

                      {/* ===== Commercial specifics ===== */}
                      {isCommercial() && (
                        <>
                          <div className="mb-6">
                            <label className={lbl3}>{tr('listProperty.fields.fitOutStatus')}</label>
                            <div className="flex flex-wrap gap-3">
                              {shellOptions.map(([v, l]) => (
                                <Pill key={v} selected={form.shellType === v} onClick={() => set('shellType', v)} className="px-6 py-3">{l}</Pill>
                              ))}
                            </div>
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
                              <input inputMode="numeric" maxLength={3} value={form.parkingSpaces} onChange={(e) => set('parkingSpaces', toDigits(e.target.value))}
                                placeholder={tr('listProperty.ph.eg4')} className={fld} />
                            </div>
                          </div>

                          {/* Maintenance / CAM and Suitable For share one row so
                             neither stretches the full width or leaves the other
                             half empty — CAM stays a compact half-width input. */}
                          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div>
                              <label className={`${lbl} mb-1`}>{tr('listProperty.fields.maintenanceCam')}</label>
                              <p className="text-gray-600 text-xs mb-3">{tr('listProperty.help.camPerSqft')}</p>
                              <input inputMode="numeric" maxLength={5} value={form.camCharges} onChange={(e) => set('camCharges', toDigits(e.target.value))}
                                placeholder={tr('listProperty.ph.eg12')} className={fld} />
                            </div>
                            <div>
                              <label className={`${lbl} mb-1`}>{tr('listProperty.fields.suitableFor')}</label>
                              <p className="text-gray-600 text-xs mb-3">{tr('listProperty.help.suitableForHelp')}</p>
                              <MultiSelect
                                values={form.suitableFor || []}
                                onChange={(v) => set('suitableFor', v)}
                                placeholder={tr('listProperty.ph.selectSuitable')}
                                ariaLabel={tr('listProperty.aria.suitableFor')}
                                options={suitableForTags}
                              />
                            </div>
                          </div>

                          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <ToggleRow title={tr('listProperty.toggle.powerBackup')} subtitle={tr('listProperty.toggle.powerBackupSub')} on={form.powerBackup} onClick={() => set('powerBackup', !form.powerBackup)} />
                            <ToggleRow title={tr('listProperty.toggle.pantry')} subtitle={tr('listProperty.toggle.pantrySub')} on={form.pantry} onClick={() => set('pantry', !form.pantry)} />
                          </div>

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
                        </>
                      )}

                      {/* ===== Land specifics (Open Plot / Farm Land) ===== */}
                      {isLand() && (
                        <>
                          <div className="mb-6 grid grid-cols-2 gap-4">
                            <div>
                              <label className={lbl3}>{tr('listProperty.fields.plotLength')}</label>
                              <div className="relative">
                                <input inputMode="decimal" maxLength={6} value={form.plotLength} onChange={(e) => set('plotLength', toDecimal(e.target.value))}
                                  placeholder={tr('listProperty.ph.eg60')} className={`${fld} pr-14`} />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-2 py-1 rounded-lg">ft</div>
                              </div>
                            </div>
                            <div>
                              <label className={lbl3}>{tr('listProperty.fields.plotWidth')}</label>
                              <div className="relative">
                                <input inputMode="decimal" maxLength={6} value={form.plotWidth} onChange={(e) => set('plotWidth', toDecimal(e.target.value))}
                                  placeholder={tr('listProperty.ph.eg40')} className={`${fld} pr-14`} />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-2 py-1 rounded-lg">ft</div>
                              </div>
                            </div>
                          </div>

                          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div>
                              <label className={lbl3}>{tr('listProperty.fields.approachRoadWidth')}</label>
                              <div className="relative">
                                <input inputMode="decimal" maxLength={6} value={form.roadWidth} onChange={(e) => set('roadWidth', toDecimal(e.target.value))}
                                  placeholder={tr('listProperty.ph.eg30')} className={`${fld} pr-14`} />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-2 py-1 rounded-lg">ft</div>
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

                          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <ToggleRow title={tr('listProperty.toggle.cornerPlot')} subtitle={tr('listProperty.toggle.cornerPlotSub')} on={form.cornerPlot} onClick={() => set('cornerPlot', !form.cornerPlot)} />
                            <ToggleRow title={tr('listProperty.toggle.boundaryWall')} subtitle={tr('listProperty.toggle.boundaryWallSub')} on={form.boundaryWall} onClick={() => set('boundaryWall', !form.boundaryWall)} />
                            {!isFarm && (
                              <ToggleRow title={tr('listProperty.toggle.naSanctioned')} subtitle={tr('listProperty.toggle.naSanctionedSub')} on={form.naSanctioned} onClick={() => set('naSanctioned', !form.naSanctioned)} />
                            )}
                            {isFarm && (
                              <>
                                <ToggleRow title={tr('listProperty.toggle.electricity')} subtitle={tr('listProperty.toggle.electricitySub')} on={form.electricity} onClick={() => set('electricity', !form.electricity)} />
                                <ToggleRow title={tr('listProperty.toggle.roadAccess')} subtitle={tr('listProperty.toggle.roadAccessSub')} on={form.roadAccess} onClick={() => set('roadAccess', !form.roadAccess)} />
                                <ToggleRow title={tr('listProperty.toggle.satbara')} subtitle={tr('listProperty.toggle.satbaraSub')} on={form.satbara} onClick={() => set('satbara', !form.satbara)} />
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
