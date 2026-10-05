import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { inr, genderPref, foodLabel, seatsLeft, hostTierMeta, showHostBadge, moveInLabel, FLATMATE_IMG, roomTitle } from '../helpers.js';
import { roomKindOf, perPersonRent, bestPerPersonRent, hasSharerAlready, roomTypeLabel } from '../model.js';
import { Fresh, ReviewChip } from '../atoms.jsx';
import { roomPriceLabel, occupancyNote, canChooseShare } from '../RoomCard.jsx';
import { DetailLayout, Identity, Sheet, Section, InfoRows, Tags, Gallery, PriceCard, StickyAsk } from './parts.jsx';
import HeaderActions from './HeaderActions.jsx';
import RoomAskButton from '../RoomAskButton.jsx';

const SHARES = [['solo', 'shareSolo'], ['bring', 'shareBring'], ['match', 'shareMatch']];

export default function RoomDetail({ r, owned, ask, saved, onSave, onAsk, onReport, ownerPanel, back }) {
  const { t } = useTranslation();
  const [share, setShare] = useState('solo');
  const shareMax = r.shareMax || 1;
  const canShare = canChooseShare(r);
  const kind = roomKindOf(r);
  const tierMeta = showHostBadge(r, r.reviewStatus, !!r.verified) ? hostTierMeta(r) : null;
  const note = occupancyNote(r, t);
  const moveIn = r.moveIn || r.availableFrom;
  const loc = r.localities?.[0] || '';
  const title = roomTitle(r);
  const photos = r.photos?.length ? r.photos : [r.img || FLATMATE_IMG];
  const price = inr(bestPerPersonRent(r));

  const cta = !owned && <RoomAskButton ask={ask} onAsk={() => onAsk(r, canShare ? share : 'solo')} className="w-full px-4 py-3" />;

  const header = (
    <Identity
      title={title}
      meta={<span className="inline-flex items-center gap-1"><Icon name="map-pin" className="w-3.5 h-3.5 text-teal-300 shrink-0" />{[r.title && r.society, loc, r.flatType, r.gatedCommunity && t('flatmates.gated')].filter(Boolean).join(' · ')}</span>}
      badges={<>
        {r.verified && <span className="badge-seeker inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider"><Icon name="shield-check" className="w-3 h-3" /> {t('flatmates.verified')}</span>}
        {tierMeta && <span className={'chip px-2 py-0.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1 ' + tierMeta.cls}><Icon name={tierMeta.icon} className="w-3 h-3" /> {tierMeta.label}</span>}
        <ReviewChip status={r.reviewStatus} kind="room" id={r.id} owned={owned} />
        {r.seatsOpen != null && <span className="chip px-2 py-0.5 rounded-md text-[11px] font-bold text-gray-200">{seatsLeft(r) > 0 ? t('flatmates.seatsOpen', { count: seatsLeft(r) }) : t('flatmates.filled')}</span>}
        <Fresh item={r} />
      </>}
    />
  );

  const aside = (
    <>
      {ownerPanel}
      <PriceCard
        label={roomPriceLabel(r, t)}
        value={price}
        sub={canShare ? (
          <p className="text-xs text-teal-200/90 mt-1">
            {t('flatmates.roomRentIs', { price: inr(r.budget) })} · {t('flatmates.eachIfShare', { price: inr(perPersonRent(r, 2)), count: 2 })}
            {shareMax >= 3 && <> · {t('flatmates.eachIfShare', { price: inr(perPersonRent(r, 3)), count: 3 })}</>}
          </p>
        ) : hasSharerAlready(r) && (
          <p className="text-xs text-teal-200/90 mt-1">{t('flatmates.roomRentIs', { price: inr(r.budget) })} · {t('flatmates.roomHasSharer')}</p>
        )}
        facts={[['wallet', t('flatmates.deposit'), r.deposit ? inr(r.deposit) : '\u2014'], ['calendar', t('flatmates.moveIn'), moveIn ? moveInLabel(moveIn, 'From ') : '\u2014']]}
        cta={cta}
      >
        {note && <p className="mt-3 text-xs font-semibold text-amber-300 inline-flex items-center gap-1.5"><Icon name="info" className="w-3.5 h-3.5 shrink-0" />{note}</p>}
        {!owned && canShare && !ask && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 mb-2">{t('flatmates.howTakeRoom')}</p>
            <div className="flex flex-wrap gap-1.5">
              {SHARES.map(([v, k]) => (
                <button key={v} type="button" onClick={() => setShare(v)} aria-pressed={share === v} className={'seg min-h-[40px] text-xs font-semibold px-3 rounded-xl' + (share === v ? ' active text-white' : ' text-gray-400')}>{t('flatmates.' + k)}</button>
              ))}
            </div>
          </div>
        )}
      </PriceCard>
    </>
  );

  return (
    <DetailLayout
      back={back}
      actions={<HeaderActions saved={saved} onSave={onSave} shareText={t('flatmates.shareRoomText', { society: title, locality: loc, price: inr(r.budget) })} reportLabel={t('flatmates.ariaReportRoom')} onReport={!owned && (() => onReport({ id: r.id, title, ownerName: title, kind: 'share' }))} />}
      hero={<Gallery id={r.id} photos={photos} alt={title} />}
      header={header}
      aside={aside}
      sticky={cta && <StickyAsk price={price} label={roomPriceLabel(r, t)}>{cta}</StickyAsk>}
    >
      <Sheet>
        <Section icon="home" title={t('flatmates.detailDetails')}>
          <InfoRows items={[
            [t('flatmates.detailFlat'), r.flatType],
            [t('flatmates.detailRoom'), [kind && t('flatmates.roomKind_' + kind), roomTypeLabel(r, t)].filter(Boolean).join(' · ')],
            [t('property.furnishingLabel'), r.furnishing && t('property.furnishing.' + r.furnishing)],
            [t('flatmates.detailBath'), r.attachedBath === 'attached' ? t('flatmates.attachedBath') : t('flatmates.detailSharedBath')],
            [t('flatmates.detailOpenTo'), genderPref(r.gender)],
            [t('flatmates.detailFood'), foodLabel(r.food)],
            [t('flatmates.detailHome'), r.homeTypeLabel !== 'Flat' && r.homeTypeLabel],
            [t('property.facing'), r.facing],
            [t('property.overlooking'), r.overlooking],
          ]} />
        </Section>
        {r.tags?.length > 0 && <Section icon="sparkles" title={t('flatmates.lifestyle')}><Tags items={r.tags} /></Section>}
        {r.note && <Section icon="message-square" title={t('flatmates.detailAbout')}><p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{r.note}</p></Section>}
      </Sheet>
    </DetailLayout>
  );
}
