import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { SOC_AMEN, titleCase } from '../constants.js';
import { buildAbout } from '../helpers.jsx';

export default function OverviewTab({ ctx }) {
  const { t } = useTranslation();
  const { soc, locName, living } = ctx;
  return (
            <>
            {/* About */}
            <section className="glass rounded-2xl p-6 reveal">
              <h2 className="text-lg font-bold mb-2 flex items-center gap-2"><Icon name="info" className="w-5 h-5 text-teal-400" /> {t('society.aboutTitle')}</h2>
              <p className="text-gray-400 text-sm leading-relaxed">{buildAbout(soc, locName, t)}</p>
            </section>

            {/* Living reality */}
            {living.length ? (
              <section className="reveal">
                <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><Icon name="clipboard-list" className="w-5 h-5 text-teal-400" /> {t('society.livingAt', { name: soc.name })}</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {living.map(([icon, labelKey, val]) => (
                    <div key={labelKey} className="detail-card">
                      <span className="w-8 h-8 rounded-lg bg-brand-teal/10 flex items-center justify-center flex-shrink-0"><Icon name={icon} className="w-4 h-4 text-brand-teal-3" /></span>
                      <div className="min-w-0"><div className="text-[11px] text-slate-500">{t(labelKey)}</div><div className="text-sm font-semibold text-white truncate">{typeof val === 'object' ? t(val.key, val.args) : val}</div></div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* Amenities */}
            {soc.amenities?.length ? (
              <section className="reveal">
                <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><Icon name="sparkles" className="w-5 h-5 text-teal-400" /> {t('society.amenities')}</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {soc.amenities.map((a) => {
                    // An amenity not in SOC_AMEN came from a community submission, so
                    // it has no key to translate — show the raw slug, title-cased.
                    const known = SOC_AMEN[a];
                    const label = known ? t(known[0]) : titleCase(a);
                    const icon = known ? known[1] : 'sparkles';
                    return (
                      <div key={a} className="amenity-card"><span className="w-8 h-8 rounded-lg bg-brand-teal/10 flex items-center justify-center flex-shrink-0"><Icon name={icon} className="w-4 h-4 text-brand-teal-3" /></span><span className="text-sm font-medium text-white">{label}</span></div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            </>
  );
}
