import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import PropertyImage from '../../../components/ui/PropertyImage.jsx';
import { CARD_SIZES } from '../../../lib/imgSrcSet.js';
import { inr, matchFor, moveInLabel, FLATMATE_IMG, detailPath, roomTitle, hostTierMeta, showHostBadge } from './helpers.js';
import { roomKindOf, occupancyOf, filledSeatsOf, priceBasisOf, bestPerPersonRent, hasSharerAlready, roomTypeLabel, PRICE_ROOM, OCCUPANCY_EMPTY, OCCUPANCY_OCCUPIED } from './model.js';
import { SaveBtn, MatchPill, Fresh, CardLink, TileChip } from './atoms.jsx';

export function roomPriceLabel(r, tr) {
  /* Per-room pricing: the owner sets one rent for the room and tenants decide whether to split
   * it, so the headline is the room's rent and the per-person price is derived. */
  const perRoom = priceBasisOf(r) === PRICE_ROOM;
  if (perRoom && hasSharerAlready(r)) return tr('flatmates.yourShareMo');
  if (perRoom && (r.shareMax || 1) > 1) return tr('flatmates.fromPerPersonMo');
  return perRoom ? tr('flatmates.roomRentMo') : tr('flatmates.yourShareMo');
}

function roomPriceTag(r, tr) {
  const perRoom = priceBasisOf(r) === PRICE_ROOM;
  if (perRoom && !hasSharerAlready(r)) return tr((r.shareMax || 1) > 1 ? 'flatmates.tagEachIfShared' : 'flatmates.tagRoomRent');
  return tr('flatmates.tagYourShare');
}

export const canChooseShare = (r) => priceBasisOf(r) === PRICE_ROOM && (r.shareMax || 1) > 1 && !hasSharerAlready(r);

export function occupancyNote(r, tr) {
  const occupancy = occupancyOf(r);
  if (occupancy === OCCUPANCY_OCCUPIED) return null;
  return occupancy === OCCUPANCY_EMPTY
    ? tr('flatmates.vacantHomeBadge')
    : tr('flatmates.fillingHomeNote', { count: r.flatCommitted != null ? r.flatCommitted : filledSeatsOf(r) });
}

function RoomCard({ r, i, saved, onSave, anchorId, myPost }) {
  const { t: tr } = useTranslation();
  const match = matchFor({ ...r, budget: bestPerPersonRent(r) }, myPost);
  const trust = showHostBadge(r, r.reviewStatus, !!r.verified) ? hostTierMeta(r).label : r.verified ? tr('flatmates.verified') : null;
  const kind = roomKindOf(r);
  const moveIn = r.moveIn || r.availableFrom;
  const href = detailPath('room', r.id);
  const title = roomTitle(r);
  const where = [r.title && r.society, r.localities?.[0] || r.locality].filter(Boolean).join(', ');
  const facts = [['bed-double', r.flatType], ['door-open', kind && tr('flatmates.roomKind_' + kind)], ['users', roomTypeLabel(r, tr)]].filter(([, label]) => label);
  return (
    <div data-sf-id={anchorId} className="sf-card relative rounded-2xl overflow-hidden reveal" style={{ animationDelay: i * 0.03 + 's' }}>
      <div className="relative h-48 bg-white/5">

        <PropertyImage src={r.img || r.cover || FLATMATE_IMG} sizes={CARD_SIZES} alt={title} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        {trust && <span className="badge-verified-icon absolute top-3 left-3" role="img" aria-label={trust} title={trust}><Icon name="shield-check" /></span>}
        <SaveBtn k={'r:' + r.id} saved={saved} onSave={onSave} className="absolute top-3 right-3 z-[1] bg-black/40 backdrop-blur text-gray-200" />
        <span className="absolute bottom-3 left-3 flex gap-1.5">{match ? <MatchPill match={match} /> : <Fresh item={r} />}</span>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-white leading-snug truncate"><Link to={href} data-tap-exempt className="relative z-[1]">{title}</Link></h3>
            {where && <p className="flex items-center gap-1 text-xs text-gray-400 mt-1"><Icon name="map-pin" className="w-3 h-3 text-teal-400 shrink-0" /><span className="truncate">{where}</span></p>}
          </div>
          <div className="text-right shrink-0">
            <p className="sf-price text-lg font-extrabold text-white leading-tight whitespace-nowrap">{inr(bestPerPersonRent(r))}<span className="text-sm font-normal text-gray-400">{tr('flatmates.perMonth')}</span></p>
            <span className="block text-[11px] text-gray-500 mt-0.5 whitespace-nowrap">{roomPriceTag(r, tr)}</span>
          </div>
        </div>
        {facts.length > 0 && <div className="flex items-center gap-3 text-xs text-gray-400 mt-3 flex-wrap">{facts.map(([ic, label]) => <span key={ic} className="flex items-center gap-1"><Icon name={ic} className="w-3.5 h-3.5" /> {label}</span>)}</div>}
        {moveIn && <div className="flex mt-3"><TileChip icon="calendar-check">{moveInLabel(moveIn, 'From ')}</TileChip></div>}
      </div>
      <CardLink to={href} />
    </div>
  );
}

export default RoomCard;
