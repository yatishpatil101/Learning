import { Video as VideoIcon, CheckCircle2, Trash2, ArrowLeft, FileText, BadgeCheck, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import StepHeader from './StepHeader.jsx';
import FeatureSelector from '../../../components/ui/FeatureSelector';
import PhotoUploader from './PhotoUploader.jsx';
import { fld, lbl, lbl3 } from './styles.js';
import { docsFor, amenitiesFor, isLandType } from './constants.js';

const PhotosDocumentsStep = ({
  form, set, errors, toggleInArray,
  photos, handlePhotoUpload, removePhoto, setPhotoCategory,
  video, videoName, handleVideoUpload, setVideo, setVideoName,
  documents, handleDocUpload, prevStep, submitProperty, onReset,
}) => {
  const { t } = useTranslation();
  return (
                <div className="lp-step">
                  <StepHeader title={t('listProperty.steps.photosTitle')} subtitle={t('listProperty.steps.photosSubtitle')} onReset={onReset} />

                  {/* Photos */}
                  <PhotoUploader
                    form={form}
                    photos={photos}
                    handlePhotoUpload={handlePhotoUpload}
                    removePhoto={removePhoto}
                    setPhotoCategory={setPhotoCategory}
                    error={errors.photos}
                  />

                  {/* Video */}
                  <div className="mb-6">
                    <label className={`${lbl} mb-1`}>{t('listProperty.fields.propertyVideo')} <span className="text-gray-500 font-normal">{t('listProperty.optional')}</span></label>
                    <p className="text-gray-500 text-xs mb-3">{t('listProperty.help.videoHelp')}</p>
                    {!video ? (
                      <label className="upload-zone rounded-2xl p-4 text-center block cursor-pointer">
                        <input type="file" className="hidden" accept="video/*" onChange={handleVideoUpload} />
                        <div className="w-11 h-11 rounded-xl bg-teal-400/10 border border-teal-400/20 flex items-center justify-center mx-auto mb-2"><VideoIcon className="w-5 h-5 text-teal-400" /></div>
                        <p className="text-white font-medium text-sm mb-0.5">{t('listProperty.photosDocs.videoUploadTitle')}</p>
                        <p className="text-gray-500 text-xs">{t('listProperty.photosDocs.videoUploadSub')}</p>
                      </label>
                    ) : (
                      <div className="upload-zone rounded-2xl p-6 text-center">
                        <video src={video} className="w-full max-h-64 rounded-xl mx-auto" controls />
                        <p className="text-emerald-300 text-xs mt-2 flex items-center justify-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> {videoName}</p>
                        <button type="button" onClick={() => { setVideo(null); setVideoName(''); }} className="text-gray-400 hover:text-red-400 text-xs mt-2 inline-flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> {t('listProperty.photosDocs.removeVideo')}</button>
                      </div>
                    )}
                  </div>

                  {/* Documents */}
                  <div className="mb-8">
                    <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2"><BadgeCheck className="w-4 h-4 text-teal-400" /> {t('listProperty.photosDocs.docsHeader')}</h3>

                    {/* Reassurance — why we ask, so owners share with confidence */}
                    <div className="mb-4 rounded-xl border border-teal-500/15 bg-teal-500/[0.06] p-3.5 flex gap-3">
                      <ShieldCheck className="w-5 h-5 text-teal-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-teal-100/90 text-xs font-semibold">{t('listProperty.photosDocs.docsWhyTitle')}</p>
                        <p className="text-gray-400 text-xs mt-1 leading-relaxed">
                          {t('listProperty.photosDocs.docsWhyBody1')} <span className="text-white font-medium">{t('listProperty.photosDocs.docsWhyNeverShown')}</span>{t('listProperty.photosDocs.docsWhyBody2')} <span className="text-white font-medium">{t('listProperty.photosDocs.docsWhyYou')}</span> {t('listProperty.photosDocs.docsWhyBody3')} <span className="text-teal-300 font-medium">{t('listProperty.photosDocs.docsWhyVerifiedOwner')}</span> {t('listProperty.photosDocs.docsWhyBody4')}
                        </p>
                      </div>
                    </div>

                    <p className="text-gray-500 text-xs mb-3">
                      {isLandType(form.propertyType)
                        ? <>{t('listProperty.photosDocs.docsLandPre')} <span className="text-teal-400 font-medium">{t('listProperty.photosDocs.docsLandTerm')}</span> {t('listProperty.photosDocs.docsLandPost')}</>
                        : form.deal === 'buy'
                          ? <>{t('listProperty.photosDocs.docsBuyPre')} <span className="text-teal-400 font-medium">{t('listProperty.photosDocs.docsBuyTerm')}</span> {t('listProperty.photosDocs.docsBuyPost')}</>
                          : <>{t('listProperty.photosDocs.docsRentPre')} <span className="text-teal-400 font-medium">{t('listProperty.photosDocs.docsRentTerm')}</span> {t('listProperty.photosDocs.docsRentPost')}</>}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {docsFor(form.deal, form.propertyType, form.commercialType).map((d) => {
                        const has = !!documents[d.key];
                        return (
                          <div key={d.key}>
                            <label className={lbl}>
                              {d.label} <span className="text-gray-500 font-normal">{t('listProperty.optional')}</span>
                            </label>
                            <label className={`doc-upload ${has ? 'has-file' : ''}`}>
                              <input type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => handleDocUpload(d.key, e)} />
                              <FileText className="w-5 h-5 text-teal-400 flex-shrink-0" />
                              <span className="doc-name text-sm text-gray-400 truncate">{has ? documents[d.key].name : d.cta}</span>
                            </label>
                            {d.hint && <p className="text-gray-600 text-xs mt-1.5">{d.hint}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* MahaRERA — optional trust signal for sale of built/plotted
                     property. Not applicable to agricultural (farm) land. */}
                  {form.deal === 'buy' && form.propertyType !== 'farmland' && (
                    <div className="mb-8">
                      <label className={lbl3}>{t('listProperty.fields.reraNo')} <span className="text-gray-500 font-normal">{t('listProperty.optional')}</span></label>
                      <input
                        value={form.reraId}
                        maxLength={30}
                        onChange={(e) => set('reraId', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
                        placeholder={t('listProperty.ph.reraExample')}
                        className={`${fld} sm:max-w-sm`}
                      />
                      <p className="text-gray-600 text-xs mt-1.5">{t('listProperty.help.reraHelp')}</p>
                    </div>
                  )}

                  {/* Description */}
                  <div className="mb-6">
                    <label className={lbl3}>{t('listProperty.fields.description')}</label>
                    <textarea rows={5} value={form.description} onChange={(e) => set('description', e.target.value)}
                      placeholder={t('listProperty.ph.descPlaceholder')}
                      className={`${fld} resize-none`} />
                  </div>

                  {/* Amenities */}
                  {(() => {
                    const amenities = amenitiesFor(form.propertyType, form.commercialType);
                    if (!amenities.length) return null;
                    return (
                    <div className="mb-8">
                      <label className={lbl3}>{t('listProperty.fields.amenities')}</label>
                      <FeatureSelector
                        options={amenities}
                        values={form.amenities}
                        onToggle={(label) => toggleInArray('amenities', label)}
                        placeholder={t('listProperty.ph.addOtherAmenity')}
                        addAriaLabel={t('listProperty.aria.amenity')}
                      />
                    </div>
                    );
                  })()}

                  <div className="flex justify-between lp-step-actions">
                    <button onClick={prevStep} className="btn-outline px-6 py-3.5 min-h-[44px] rounded-xl text-gray-300 font-semibold text-sm flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> {t('listProperty.back')}</button>
                    <button onClick={submitProperty} className="btn-teal px-8 py-3.5 min-h-[44px] rounded-xl text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-teal-500/20"><CheckCircle2 className="w-4 h-4" /> {t('listProperty.photosDocs.submitProperty')}</button>
                  </div>
                </div>
  );
};

export default PhotosDocumentsStep;