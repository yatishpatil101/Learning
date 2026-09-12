import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import SocietyMap from '../../../../components/society/SocietyMap.jsx';

export default function LocationTab({ ctx }) {
  const { t } = useTranslation();
  const { soc, hasCoords, dirUrl, iAmResidentOrAdmin, locFix, openLocation, commute, nearby } = ctx;
  return (
            <>
            {/* Location & connectivity */}
            {!soc._generic ? (
              <section className="reveal">
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <h2 className="text-lg font-bold flex items-center gap-2 min-w-0"><Icon name="map-pin" className="w-5 h-5 text-teal-400 flex-shrink-0" /> {t('society.locationTitle')}</h2>
                  {hasCoords ? (
                    <a href={dirUrl} target="_blank" rel="noopener noreferrer" className="btn-teal flex-shrink-0"><Icon name="navigation" className="w-4 h-4 mr-1.5" /> {t('society.getDirections')}</a>
                  ) : null}
                </div>
                <Link to={`/locality/${soc.localitySlug}`} className="text-xs font-medium text-brand-teal-3 hover:underline inline-flex items-center gap-1 mb-3">{t('society.localityInsights')} <Icon name="arrow-right" className="w-3.5 h-3.5" /></Link>
                {/* Resident location correction — above the full-bleed map */}
                {(iAmResidentOrAdmin || (locFix && locFix.status === 'pending')) ? (
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    {iAmResidentOrAdmin ? (
                      <button onClick={openLocation} className="btn-outline"><Icon name="map-pin" className="w-4 h-4 mr-1.5" /> {hasCoords ? t('society.suggestLocation') : t('society.addLocation')}</button>
                    ) : null}
                    {locFix && locFix.status === 'pending' ? (
                      <span className="text-xs text-amber-300 inline-flex items-center gap-1"><Icon name="clock" className="w-4 h-4" /> {t('society.locationFixPending')}</span>
                    ) : null}
                  </div>
                ) : null}
                {/* Full-bleed map tile */}
                <SocietyMap lat={hasCoords ? soc.lat : null} lng={hasCoords ? soc.lng : null} name={soc.name} height={340} />
                {!hasCoords ? (
                  <p className="text-xs text-slate-500 mt-2 mb-4">{t('society.locationNotSet')}{iAmResidentOrAdmin ? t('society.locationAddPrompt') : t('society.locationResidentsCanAdd')}</p>
                ) : soc.locSource === 'community' ? (
                  <p className="text-xs text-slate-500 mt-2 mb-4 inline-flex items-center gap-1"><Icon name="badge-check" className="w-3.5 h-3.5 text-teal-400" /> {t('society.pinConfirmed')}</p>
                ) : <div className="mb-4" />}
                <div className="space-y-4">
                  {/* Commute to work — same tile pattern as the property Location tab */}
                  {commute.legs.length ? (
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2"><Icon name="briefcase" className="w-4 h-4 text-brand-teal-3" /> {t('society.commuteTitle')}</h3>
                        {commute.source === 'live' ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-teal-3"><span className="w-1.5 h-1.5 rounded-full bg-brand-teal-2 animate-pulse" /> {t('society.liveTraffic')}</span>
                        ) : (
                          <span className="text-[11px] text-slate-500">{t('society.approxByRoad')}</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                        {commute.legs.map((c) => (
                          <div key={c.name} className="rd-cell">
                            <div className="rd-lbl truncate">{c.name}</div>
                            <div className="rd-val flex items-baseline gap-1">{c.min}<span className="text-[11px] font-medium text-slate-400">{t('society.min')}</span></div>
                            <div className="text-[11px] text-slate-500 mt-0.5">{t('society.kmDrive', { km: c.km })}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {/* What's nearby — same landmark cards as the property Location tab */}
                  {nearby.length ? (
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-2.5"><Icon name="map-pinned" className="w-4 h-4 text-brand-teal-3" /> {t('society.nearbyTitle')}</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {nearby.map((n) => (
                          <div key={n.name} className="detail-card"><span className="w-8 h-8 rounded-lg bg-brand-teal/10 flex items-center justify-center flex-shrink-0"><Icon name={n.icon} className="w-4 h-4 text-brand-teal-3" /></span><div className="min-w-0 flex-1"><div className="text-sm font-medium text-white truncate">{n.name}</div><div className="text-[11px] text-slate-500">{n.cat}</div></div><span className="text-xs font-semibold text-brand-teal-3 flex-shrink-0">{n.dist}</span></div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}
            </>
  );
}
