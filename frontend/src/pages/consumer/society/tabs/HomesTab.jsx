import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { fmtINR, fmtNum } from '../../../../lib/format.js';

export default function HomesTab({ ctx }) {
  const { t } = useTranslation();
  const { listings, priceStats } = ctx;
  return (
            <>
            {/* Homes in this society */}
            {listings.length ? (
              <section className="reveal">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Icon name="building-2" className="w-5 h-5 text-teal-400" /> {t('society.homesTitle')}</h2>
                  <span className="text-sm text-gray-400">{t('society.forSaleRent', { sale: priceStats.forSale, rent: priceStats.forRent })}</span>
                </div>
                {priceStats.psf || priceStats.rentAvg ? (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
                    {priceStats.psf ? <div className="rd-cell"><div className="rd-lbl">{t('society.avgRate')}</div><div className="rd-val mt-0.5">₹{fmtNum(priceStats.psf)}<span className="text-[11px] font-medium text-slate-400">{t('society.perSqft')}</span></div></div> : null}
                    {priceStats.rentAvg ? <div className="rd-cell"><div className="rd-lbl">{t('society.avgRent')}</div><div className="rd-val mt-0.5">₹{fmtNum(priceStats.rentAvg)}<span className="text-[11px] font-medium text-slate-400">{t('society.perMonth')}</span></div></div> : null}
                  </div>
                ) : null}
                <div className="grid sm:grid-cols-2 gap-4">
                  {listings.slice(0, 6).map((x) => { const rent = x.deal === 'rent'; const baths = x.bhkNum ? Math.max(1, x.bhkNum - 1) : 1; return (
                    <Link key={x.id} to={`/property/${x.id}`} className="glass rounded-2xl p-4 block hover:border-teal-400/30 transition-all">
                      <div className="flex items-center justify-between mb-1">
                        {rent ? <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide bg-teal-600/50 text-teal-50">{t('society.rent')}</span> : <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide bg-emerald-600/50 text-emerald-50">{t('society.sale')}</span>}
                        <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide text-white" style={{ background: 'rgba(16,185,129,.9)' }}>{t('society.zeroBrokerageTag')}</span>
                      </div>
                      <p className="text-white font-bold text-lg mt-1">{rent ? '₹' + fmtNum(x.price) + t('society.perMonth') : fmtINR(x.price)}</p>
                      <p className="text-gray-300 text-sm truncate">{x.title}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-2"><span className="flex items-center gap-1"><Icon name="bed-double" className="w-3 h-3" /> {x.bhk}</span><span className="flex items-center gap-1"><Icon name="bath" className="w-3 h-3" /> {baths}</span><span className="flex items-center gap-1"><Icon name="maximize-2" className="w-3 h-3" /> {fmtNum(x.area)} {t('society.sqft')}</span></div>
                    </Link>
                  ); })}
                </div>
              </section>
            ) : null}

            </>
  );
}
