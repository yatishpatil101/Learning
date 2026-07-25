import { lazy, Suspense } from 'react';
import Icon from '../../../components/Icon.jsx';
import Tip from '../../../components/ui/Tip.jsx';
import { cityLabelFor } from '../../../lib/geoConfig.js';
import { AMEN_ICON, AMEN_LABEL } from './derivations.js';
import { FloorPlan } from './FloorPlan.jsx';
import { SocietySection } from './SocietySection.jsx';
import { ReviewsSection } from './ReviewsSection.jsx';
import LocationInsights from './LocationInsights.jsx';
import { RentDetails } from './RentDetails.jsx';
import { PriceInsights } from './PriceInsights.jsx';
import { VerificationSection } from './VerificationSection.jsx';
import { DocumentsSection } from './DocumentsSection.jsx';
import VerificationDisclaimer from '../../../components/property/VerificationDisclaimer.jsx';
import { SimilarProperties } from './SimilarProperties.jsx';

const PropertyMap = lazy(() => import('../../../components/property/PropertyMap.jsx'));

export default function PropertyTabs({ ctx }) {
  const {
    current, tr, topHighlights, details, p, ovOpen, setOvOpen, overviewMore,
    isLand, kind, flagEnabled, isIn, setReportOpen, toast, isRent, user,
  } = ctx;
  return (
    <>
          {/* TAB: OVERVIEW — Key Details, description, floor plan */}
          {current === 'overview' ? (
            <>
              {/* KEY DETAILS (with highlight pills merged in) */}
              <section className="fade-in section-mb">
                <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 flex items-center gap-2"><Icon name="layout-grid" className="w-5 h-5 text-brand-teal-2" /> {tr('property.keyDetails')}</h2>
                {topHighlights.length ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-2.5">
                    {topHighlights.map(([ic, label]) => (
                      <div key={label} className="highlight-pill">
                        <span className="w-8 h-8 rounded-lg bg-brand-teal/10 flex items-center justify-center flex-shrink-0">
                          <Icon name={ic} className="w-4 h-4 text-brand-teal-3" />
                        </span>
                        <span className="text-sm font-semibold text-white leading-tight">{label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {details.map(([ic, lbl, val, tipKey]) => {
                    const empty = val == null || val === '' || val === '—' || val === 0;
                    const tile = (
                      <div className="detail-card">
                        <span className="w-8 h-8 rounded-lg bg-brand-teal/10 flex items-center justify-center flex-shrink-0">
                          <Icon name={ic} className="w-4 h-4 text-brand-teal-3" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[11px] text-slate-400 leading-tight mb-0.5">{lbl}</p>
                          <p className={empty ? 'text-sm font-medium text-slate-500 truncate' : 'text-sm font-semibold text-white truncate'}>{empty ? tr('property.notSpecified') : val}</p>
                        </div>
                      </div>
                    );
                    return <Tip key={lbl} k={tipKey}>{tile}</Tip>;
                  })}
                </div>
              </section>

              {/* OVERVIEW */}
              <section className="fade-in section-mb">
                <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 flex items-center gap-2"><Icon name="file-text" className="w-5 h-5 text-brand-teal-2" /> {tr('property.overviewHeading')}</h2>
                <div className="glass rounded-2xl p-6 sm:p-8 space-y-4 text-slate-300 leading-relaxed">
                  <p>{p.desc}</p>
                  {ovOpen ? (
                    <p>{overviewMore}</p>
                  ) : null}
                  <button type="button" onClick={() => setOvOpen((v) => !v)} className="text-sm font-semibold text-brand-teal-3 hover:text-brand-teal-2 transition-smooth inline-flex items-center gap-1">
                    {ovOpen ? tr('property.readLess') : tr('property.readMore')} <Icon name="chevron-down" className="w-4 h-4" style={{ transform: ovOpen ? 'rotate(180deg)' : '' }} />
                  </button>
                </div>
              </section>

              {/* FLOOR PLAN (built units only — a plot has no floor plan) */}
              {!isLand ? <FloorPlan p={p} /> : null}
            </>
          ) : null}

          {/* TAB: AMENITIES & SOCIETY */}
          {current === 'amenities' ? (
            <>
              {/* AMENITIES */}
              {p.amenities && p.amenities.length ? (
                <section className="fade-in section-mb">
                  <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 flex items-center gap-2"><Icon name="sparkles" className="w-5 h-5 text-brand-teal-2" /> {tr('property.amenitiesHeading')}</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                    {p.amenities.map((a) => (
                      <div key={a} className="amenity-card">
                        <span className="w-8 h-8 rounded-lg bg-brand-teal/10 flex items-center justify-center flex-shrink-0">
                          <Icon name={AMEN_ICON[a] || 'sparkles'} className="w-4 h-4 text-brand-teal-3" />
                        </span>
                        <span className="text-sm font-medium text-white">{AMEN_LABEL[a] || a}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* SOCIETY INFORMATION — a registered co-op housing society (homes/towers/
                  conveyance deed) is a residential concept; commercial units & plots
                  aren't part of one, so it only shows for residential built property. */}
              {kind === 'residential' ? <SocietySection p={p} /> : null}

              {/* RATINGS & REVIEWS */}
              {flagEnabled('reviewsEnabled') && <ReviewsSection p={p} isIn={isIn} onReport={() => setReportOpen(true)} toast={toast} />}
            </>
          ) : null}

          {/* TAB: LOCATION */}
          {current === 'location' ? (
            <section className="fade-in section-mb">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 min-w-0"><Icon name="map-pin" className="w-5 h-5 text-brand-teal-2 flex-shrink-0" /> {tr('property.locationHeading')}</h2>
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat || 18.5590},${p.lng || 73.7868}`} target="_blank" rel="noopener noreferrer" className="btn-teal flex-shrink-0"><Icon name="navigation" className="w-4 h-4 mr-1.5" /> {tr('property.directions')}</a>
              </div>
              <div className="h-[340px] sm:h-[400px]">
                <Suspense fallback={<div className="flex items-center justify-center h-full rounded-2xl border border-white/10 bg-white/5"><div className="w-8 h-8 border-2 border-teal-400/30 border-t-teal-400 rounded-full animate-spin" /></div>}>
                  <PropertyMap properties={[{ ...p, lat: p.lat || 18.5590, lng: p.lng || 73.7868 }]} locName={{ [p.localitySlug]: p.locality }} />
                </Suspense>
              </div>
              <p className="text-xs text-slate-400 mt-2.5 flex items-center gap-1.5"><Icon name="map-pin" className="w-3.5 h-3.5 text-brand-teal-3 flex-shrink-0" /> {p.locality}, {cityLabelFor(p)}</p>
              <LocationInsights p={p} lat={p.lat || 18.5590} lng={p.lng || 73.7868} />
            </section>
          ) : null}

          {/* TAB: PRICING — buy shows insights, rent shows rent terms */}
          {current === 'pricing' ? (
            <>
              {isRent ? <RentDetails p={p} /> : null}
              {!isRent ? <PriceInsights p={p} /> : null}
            </>
          ) : null}

          {/* TAB: VERIFICATION & DOCS */}
          {current === 'trust' ? (
            <>
              <VerificationSection p={p} />
              <DocumentsSection p={p} user={user} isIn={isIn} toast={toast} />
              <div className="section-mb"><VerificationDisclaimer deal={p.deal} /></div>
            </>
          ) : null}

          {/* SIMILAR PROPERTIES */}
          <SimilarProperties p={p} />

    </>
  );
}
