import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { societyForListing } from '../../../data/societies.js';
import { resolveSociety } from '../../../lib/store.js';
import { getEntityReviewSummary } from '../../../services/reviewService.js';
import { Stars } from './Stars.jsx';

export function SocietySection({ p }) {
  const { t } = useTranslation();
  const base = societyForListing(p);
  const soc = base ? (resolveSociety(base.slug) || base) : null;
  const socName = soc ? soc.name : t('property.societyBuilding');
  const verified = soc ? (soc.registration && soc.conveyance) : !!p.ownershipVerified;
  const claimed = soc && soc.claimStatus === 'claimed';
  /* SEAM NOTE: one society's aggregate, from the seam, keyed on the **slug**.

     The society itself comes from `data/societies.js`, so `soc.id` is a synthetic `S01` the server
     has never seen; the reviews the hub writes are keyed on `soc.slug`. This used to reduce the
     `entityRating` localStorage bucket, which a live session never writes — so against the real API
     it was permanently empty, and the empty branch rendered a hard-coded `4.2` as a real star
     rating. That is the fabricated-`registration: true` defect in a more quantitative costume: a
     reader had no way to tell 4.2-because-people-said-so from 4.2-because-a-developer-typed-it.

     `getEntityReviewSummary` is one request, already live, and already what the society hub uses.
     `services/societyService.js` indexes `avgRating`/`reviewCount` off `GET /societies` for the
     *directory*; that read is deliberately not used here, because it walks four pages / 348 rows to
     draw one star.

     Three states, not two: `null` = we have not been told yet (or the read failed), which renders
     the builder alone and claims nothing; `count === 0` = the server says nobody has rated it, which
     is the only branch entitled to say "Not rated yet"; `count > 0` = a real average. The server is
     careful about this distinction — `SocietyResponse` returns `avgRating: null` for an unrated
     society and its docblock says "no rating is not a rating of zero" — and the client's job is to
     stop undoing it. */
  const [rating, setRating] = useState(null);
  const slug = soc ? soc.slug : null;
  useEffect(() => {
    if (!slug) { setRating(null); return undefined; }
    let alive = true;
    setRating(null);
    getEntityReviewSummary('society', slug)
      .then((s) => { if (alive) setRating(s); })
      .catch(() => {});
    return () => { alive = false; };
  }, [slug]);

  const quick = soc ? [
    ['home', t('property.homesCount', { count: soc.units })],
    ['building-2', t('property.towersCount', { count: soc.towers })],
    ['calendar', t('property.builtYear', { year: soc.year })],
    ['users', t('property.occupied', { occupancy: soc.occupancy })],
  ] : [];

  const card = (ok, icon, title, okLabel, noLabel, okDesc, noDesc) => (
    <div className={'rounded-xl border p-5 flex items-start gap-3 ' + (ok ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-white/10 bg-white/5')}>
      <div className={'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ' + (ok ? 'bg-emerald-500/15' : 'bg-white/10')}>
        <Icon name={icon} className={'w-5 h-5 ' + (ok ? 'text-emerald-400' : 'text-slate-400')} />
      </div>
      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <p className="font-semibold text-white text-sm">{title}</p>
          <span className={'text-[11px] font-semibold px-2 py-0.5 rounded-full ' + (ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-slate-400')}>{ok ? okLabel : noLabel}</span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">{ok ? okDesc : noDesc}</p>
      </div>
    </div>
  );

  return (
    <section className="fade-in section-mb">
      <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 flex items-center gap-2"><Icon name="building-2" className="w-5 h-5 text-brand-teal-2" /> {t('property.societyInfoHeading')}</h2>
      <div className="glass rounded-2xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-brand-teal-1/20 flex items-center justify-center flex-shrink-0"><Icon name="building" className="w-6 h-6 text-brand-teal-3" /></div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">{t('property.societyBuilding')}</p>
              <p className="font-bold text-white text-lg">{socName}</p>
              {soc ? (
                <div className="flex items-center gap-2 mt-1">
                  {rating && rating.count ? (
                    <>
                      <Stars value={rating.avg} size={13} />
                      <span className="text-xs text-slate-500" data-testid="property-society-rating">{`${Number(rating.avg).toFixed(1)} · ${t('property.societyReviewCount', { count: rating.count })}`}</span>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">{rating ? `${t('property.societyNotRated')} · ${soc.builder}` : soc.builder}</span>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          {verified ? <span className="tag tag-emerald flex items-center gap-1.5"><Icon name="shield-check" className="w-3.5 h-3.5" /> {t('property.verifiedSociety')}</span> : null}
          {claimed ? <span className="tag flex items-center gap-1.5" style={{ background: 'rgba(37,99,235,.15)', color: '#93c5fd', border: '1px solid rgba(37,99,235,.3)' }}><Icon name="shield-check" className="w-3.5 h-3.5" /> {t('property.managedOnPuneNest')}</span> : null}
        </div>

        {soc ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
            {quick.map(([icon, val]) => (
              <div key={val} className="rd-cell flex items-center gap-2">
                <Icon name={icon} className="w-4 h-4 text-brand-teal-3 flex-shrink-0" />
                <span className="text-sm font-semibold text-white truncate">{val}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {card(verified, 'badge-check', t('property.societyRegistration'), t('property.verified'), t('property.pending'), t('property.societyRegYes'), t('property.societyRegNo'))}
          {card(soc ? soc.conveyance : verified, 'file-text', t('property.conveyanceDeed'), t('property.done'), t('property.pending'), t('property.conveyanceYes'), t('property.conveyanceNo'))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-5">
          <p className="text-slate-500 text-xs flex items-center gap-1.5"><Icon name="info" className="w-3.5 h-3.5 flex-shrink-0" /> {t('property.societyFooter')}</p>
          {soc ? (
            <Link to={`/society/${soc.slug}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-teal-3 hover:underline flex-shrink-0">
              {t('property.viewSocietyProfile', { name: soc.name })} <Icon name="arrow-right" className="w-4 h-4" />
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
