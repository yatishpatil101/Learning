import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { MOD_PENDING, isPubliclyVisible } from '../../../../services/providers/http/flatmateMapper.js';
import { roomEditHref, seatCeiling, seatsLeft } from '../helpers.js';
import { priceBasisOf, PRICE_ROOM } from '../model.js';
import { Stepper } from './parts.jsx';
import { useOwnerControls } from './useOwnerControls.js';

function StatusChip({ item }) {
  const { t } = useTranslation();
  const [icon, cls, key] = item.modStatus === MOD_PENDING
    ? ['clock', 'text-amber-300', 'detailUnderReview']
    : !isPubliclyVisible(item.modStatus) ? ['eye', 'text-rose-300', 'detailNotPublic'] : ['check-circle', 'text-emerald-300', 'detailLive'];
  return <span className={'chip px-2.5 py-1 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 ' + cls}><Icon name={icon} className="w-3.5 h-3.5" /> {t('flatmates.' + key)}</span>;
}

function SeatsStepper({ kind, item, onSeats }) {
  const { t } = useTranslation();
  const left = seatsLeft(item);
  const group = kind === 'group';
  return <Stepper icon="refresh-cw" label={t('flatmates.openSeats')} value={left} onStep={onSeats} canDec={left > 0} canInc={left < seatCeiling(kind, item)} decClass="seat-close-btn" incClass="seat-reopen-btn" decLabel={t(group ? 'flatmates.ariaRemoveOpenSeat' : 'flatmates.ariaMarkSeatFilled')} incLabel={t(group ? 'flatmates.ariaAddOpenSeat' : 'flatmates.ariaReopenSeat')} />;
}

function RoomControls({ item, onSeats, onPeople, onReissue }) {
  const { t } = useTranslation();
  if (item.seatsOpen != null) return <SeatsStepper kind="room" item={item} onSeats={onSeats} />;
  if (priceBasisOf(item) !== PRICE_ROOM) return null;
  const people = Number(item.occupants) || 0;
  return (
    <>
      <Stepper icon="users" label={t('flatmates.peopleLivingHere')} value={people} onStep={onPeople} canDec={people > 0} canInc={people < 3 && !(item.flatMax != null && item.flatCommitted >= item.flatMax)} decLabel={t('flatmates.ariaRemovePerson')} incLabel={t('flatmates.ariaAddPerson')} />
      {item.flatMax != null && <p className="text-[11px] text-gray-500">{t('flatmates.flatLedger', { committed: item.flatCommitted || 0, max: item.flatMax })}</p>}
      {people > 0 && (
        <button type="button" onClick={onReissue} className="btn-ghost h-8 inline-flex items-center gap-1.5 px-3 rounded-full text-teal-300 text-[11px] font-semibold">
          <Icon name="file-text" className="w-3 h-3" /> {t('flatmates.reissueAgreement')}
        </button>
      )}
    </>
  );
}

export default function OwnerPanel({ kind, item, patch }) {
  const { t } = useTranslation();
  const { onSeats, onPeople, onReissue, onDelete } = useOwnerControls(kind, item, patch);
  const editHref = kind === 'group' ? `/flatmates?editGroup=${encodeURIComponent(item.id)}`
    : kind === 'post' ? '/flatmates?post=edit'
      : kind === 'room' && !item.propertyId ? roomEditHref(item.id) : null;
  const btn = 'min-h-[44px] min-w-0 inline-flex items-center justify-center gap-1.5 px-3 rounded-xl text-sm font-semibold ';
  return (
    <div className="sf-card rounded-2xl p-4 space-y-3 reveal" data-testid="flatmate-owner-panel">
      <div className="flex items-center justify-between gap-2">
        <span className="text-white text-sm font-semibold">{t('flatmates.detailYourPost')}</span>
        <StatusChip item={item} />
      </div>
      {kind === 'group' && <SeatsStepper kind={kind} item={item} onSeats={onSeats} />}
      {kind === 'room' && <RoomControls item={item} onSeats={onSeats} onPeople={onPeople} onReissue={onReissue} />}
      <div className="flex gap-2 [&>*]:flex-1">
        {editHref && <Link to={editHref} className={btn + 'btn-teal text-white'}><Icon name="pencil" className="w-4 h-4 shrink-0" /> {t('flatmates.edit')}</Link>}
        {kind !== 'post' && <Link to="/dashboard#leads" className={btn + 'btn-ghost text-gray-200'}><Icon name="inbox" className="w-4 h-4 shrink-0" /> {t('flatmates.detailRequests')}</Link>}
        <button type="button" onClick={onDelete} className={btn + 'btn-ghost text-rose-300'}><Icon name="trash-2" className="w-4 h-4 shrink-0" /> {t('flatmates.delete')}</button>
      </div>
    </div>
  );
}
