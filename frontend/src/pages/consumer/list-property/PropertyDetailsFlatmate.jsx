import { Home, Users, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Select from '../../../components/ui/Select';
import FeatureSelector from '../../../components/ui/FeatureSelector';
import { Pill, FieldError, ToggleRow } from './controls.jsx';
import AgreementUpload from '../flatmates/AgreementUpload.jsx';
import { fld, lbl, lbl3 } from './styles.js';
import { facingOptions, ageOptions, floorOptions, totalFloorsOptions, furnitureFor, lifestyleTags } from './constants.js';
import { toDecimal } from './sanitize.js';

export default function PropertyDetailsFlatmate({ form, set, errors, isHouse, toggleInArray, nextStep }) {
  const { t: tr } = useTranslation();

  return (
                    <div className="lp-step mt-2">
                      {/* Who's listing — host eligibility. An owner lists a spare room in
                          their own flat; a sitting tenant seeking a replacement self-attests
                          a registered agreement and can share the owner's mobile so Ops can
                          confirm consent. Tenant posts are routed to the Ops review queue. */}
                      <div className="mb-6 rounded-2xl bg-white/[0.03] border border-white/5 p-4 sm:p-5">
                        <label className={lbl3}>{tr('listProperty.fields.whoListing')}</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Pill selected={form.hostRole === 'owner'} onClick={() => set('hostRole', 'owner')} className="p-4">
                            <div className="flex items-start gap-3">
                              <Home className="w-5 h-5 text-teal-400 mt-0.5 flex-shrink-0" />
                              <div className="text-left"><p className="text-sm font-semibold text-white">{tr('listProperty.host.ownTitle')}</p><p className="text-xs text-gray-400 mt-0.5">{tr('listProperty.host.ownDesc')}</p></div>
                            </div>
                          </Pill>
                          <Pill selected={form.hostRole === 'tenant'} onClick={() => set('hostRole', 'tenant')} className="p-4">
                            <div className="flex items-start gap-3">
                              <Users className="w-5 h-5 text-teal-400 mt-0.5 flex-shrink-0" />
                              <div className="text-left"><p className="text-sm font-semibold text-white">{tr('listProperty.host.tenantTitle')}</p><p className="text-xs text-gray-400 mt-0.5">{tr('listProperty.host.tenantDesc')}</p></div>
                            </div>
                          </Pill>
                        </div>
                        {form.hostRole === 'tenant' && (
                          <div className="mt-3 space-y-3">
                            <ToggleRow
                              title={tr('listProperty.host.agreementTitle')}
                              subtitle={tr('listProperty.host.agreementSubtitle')}
                              on={form.agreementDeclared}
                              onClick={() => set('agreementDeclared', !form.agreementDeclared)}
                            />
                            {form.agreementDeclared && (
                              <AgreementUpload
                                doc={form.agreementDoc}
                                onChange={(doc) => set('agreementDoc', doc)}
                                ariaLabel={tr('listProperty.host.agreementAria')}
                                hint={tr('listProperty.host.agreementHint')}
                              />
                            )}
                            <div>
                              <label className={lbl}>{tr('listProperty.fields.homeOwnerMobile')} <span className="text-gray-500 font-normal">{tr('listProperty.optional')}</span></label>
                              <input type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={form.ownerConsentMobile} onChange={(e) => set('ownerConsentMobile', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder={tr('listProperty.ph.tenDigit')} className={fld} />
                              <p className="text-xs text-gray-500 mt-1">{tr('listProperty.host.consentHelp')}</p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mb-6">
                        <label className={lbl3}>{tr('listProperty.fields.homeType')}</label>
                        <p className="text-gray-500 text-xs mb-3">{tr('listProperty.help.homeTypeHelp')}</p>
                        <div className="flex flex-wrap gap-2.5">
                          {[['flat', 'Flat'], ['independent', 'Independent House'], ['villa', 'Villa'], ['independent', 'Row House']].map(([pt, label]) => (
                            <Pill key={label} selected={form.homeTypeLabel === label} onClick={() => { set('propertyType', pt); set('homeTypeLabel', label); }} className="px-5 py-2.5">{label}</Pill>
                          ))}
                        </div>
                      </div>

                      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div>
                          <label className={lbl3}>{isHouse() ? tr('listProperty.fields.configuration') : tr('listProperty.fields.flatType')}</label>
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

                      {/* Attached washroom — a top-3 question for room seekers, so it's
                          asked explicitly and shown as a chip + filter on Flatmates. */}
                      <div className="mb-6">
                        <label className={lbl3}>{tr('listProperty.fields.washroomForRoom')}</label>
                        <div className="flex flex-wrap gap-2.5">
                          {[['attached', tr('listProperty.opt.attachedPrivate')], ['shared', tr('listProperty.opt.sharedCommon')]].map(([v, l]) => (
                            <Pill key={v} selected={form.attachedBath === v} onClick={() => set('attachedBath', form.attachedBath === v ? '' : v)} className="px-5 py-2.5">{l}</Pill>
                          ))}
                        </div>
                      </div>

                      {/* Physical flat details — a flatmate share is the same flat as a
                          whole-place let, so it carries the same specs. All optional to
                          keep posting quick; the required set stays lean. */}
                      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div>
                          <label className={lbl3}>{tr('listProperty.fields.bathroomsOptional')}</label>
                          <div className="flex flex-wrap gap-2.5">
                            {['1', '2', '3', '4'].map((n) => (
                              <Pill key={n} selected={form.bathrooms === n} onClick={() => set('bathrooms', n)} className="px-5 py-2.5">{n === '4' ? '4+' : n}</Pill>
                            ))}
                          </div>
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

                      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className={lbl3}>{tr('listProperty.fields.carpetArea')}</label>
                          <div className="relative">
                            <input inputMode="decimal" maxLength={9} value={form.carpetArea} onChange={(e) => set('carpetArea', toDecimal(e.target.value))} placeholder={tr('listProperty.ph.eg1050')} className={`${fld} pr-20`} />
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-3 py-1 rounded-lg">sq.ft.</div>
                          </div>
                        </div>
                        <div>
                          <label className={lbl3}>{tr('listProperty.fields.builtUpArea')}</label>
                          <div className="relative">
                            <input inputMode="decimal" maxLength={9} value={form.builtUp} onChange={(e) => set('builtUp', toDecimal(e.target.value))} placeholder={tr('listProperty.ph.eg1200')} className={`${fld} pr-20`} />
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium bg-white/5 px-3 py-1 rounded-lg">sq.ft.</div>
                          </div>
                        </div>
                      </div>

                      {isHouse() ? (
                        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div>
                            <label className={lbl3}>{tr('listProperty.fields.floorsInHouse')}</label>
                            <div className="flex flex-wrap gap-2.5">
                              {[['1', tr('listProperty.opt.ground')], ['2', 'G+1'], ['3', 'G+2'], ['4', 'G+3+']].map(([v, l]) => (
                                <Pill key={v} selected={form.floorsInHouse === v} onClick={() => set('floorsInHouse', v)} className="px-5 py-2.5">{l}</Pill>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-end">
                            <ToggleRow
                              title={tr('listProperty.toggle.gatedCommunity')}
                              subtitle={tr('listProperty.toggle.gatedCommunitySub')}
                              on={form.gatedCommunity}
                              onClick={() => set('gatedCommunity', !form.gatedCommunity)}
                              className="w-full"
                            />
                          </div>
                        </div>
                      ) : (
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

                      <div className="mb-6">
                        <label className={lbl3}>{tr('listProperty.fields.furnishing')}</label>
                        <div className="flex flex-wrap gap-3">
                          {[['unfurnished', tr('listProperty.opt.unfurnished')], ['semi', tr('listProperty.opt.semiFurnished')], ['furnished', tr('listProperty.opt.furnished')]].map(([v, l]) => (
                            <Pill key={v} selected={form.furnishing === v} onClick={() => set('furnishing', v)} className="px-6 py-3">{l}</Pill>
                          ))}
                        </div>
                      </div>

                      {/* Furniture — same "What's included?" selector as a whole-place let,
                          shown once the room is furnished or semi-furnished. */}
                      {(form.furnishing === 'furnished' || form.furnishing === 'semi') && (
                        <div className="mb-8">
                          <label className={`${lbl} mb-1`}>{tr('listProperty.fields.whatsIncluded')}</label>
                          <p className="text-gray-600 text-xs mb-3">{tr('listProperty.help.furnitureIncluded', { what: tr('listProperty.word.room') })}</p>
                          <FeatureSelector
                            options={furnitureFor(form.propertyType)}
                            values={form.furniture}
                            onToggle={(label) => toggleInArray('furniture', label)}
                            placeholder={tr('listProperty.ph.addOtherFurniture')}
                            addAriaLabel={tr('listProperty.aria.furnitureItem')}
                          />
                        </div>
                      )}

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

                      <div className="mb-8">
                        <label className={lbl3}>{tr('listProperty.fields.lifestyle')} <span className="text-gray-500 font-normal">{tr('listProperty.optional')}</span></label>
                        <div className="flex flex-wrap gap-2.5">
                          {lifestyleTags.map((t) => (
                            <Pill key={t} selected={form.lifestyle.includes(t)} onClick={() => toggleInArray('lifestyle', t)} className="px-4 py-2">{t}</Pill>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-end lp-step-actions">
                        <button onClick={nextStep} className="btn-teal px-8 py-3.5 min-h-[44px] rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20">
                          {tr('listProperty.next')} <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
  );
}
