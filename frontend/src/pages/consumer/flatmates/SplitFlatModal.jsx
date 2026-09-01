import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { inr } from './helpers.js';
import { ROOM_KIND_ORDER, ROOM_KINDS } from './model.js';
import { maxRoomsForBhk, capBoundsFor, ROOM_SHARE_MAX, bedroomsOf } from '../../../lib/data/flatSplit.js';

/* SplitFlatModal — an owner turning one rent listing into per-room supply.

   The owner answers only what they are actually entitled to decide:

     · which rooms exist        (master / bedroom / hall)
     · the rent for each room   (a master with its own bathroom is worth more)
     · how many people may live in the FLAT  (their society's rule)

   They are never asked how many people fit in a given room. Tenants decide that,
   so the flat cap is the single binding ceiling and per-room occupancy stays
   emergent. The address, BHK and photos are inherited from the parent listing —
   nothing already known is retyped. */

const blankRoom = (roomKind) => ({ roomKind, rent: '', deposit: '' });

export default function SplitFlatModal({ listing, onClose, onConfirm }) {
  const { t } = useTranslation();
  /* Both shapes a listing carries its BHK in — `bhkNum` where the view model built one, the
     display string otherwise. Read as `Number(listing.bhk)` this was NaN for every listing that
     came through either mapper ("3 BHK"), which seeded one room and a flat cap of one: a 3 BHK
     owner was offered a split they could not confirm. */
  const bhk = bedroomsOf(listing?.bhkNum ?? listing?.bhk) || 1;
  const roomCap = maxRoomsForBhk(bhk);
  // Seed with the flat's bedrooms — the common case — leaving the hall as an
  // explicit opt-in, since letting a partitioned living room is the one choice
  // societies and rent agreements are most likely to object to.
  const [rooms, setRooms] = useState(() => Array.from({ length: Math.min(bhk, 4) }, (_, i) => blankRoom(i === 0 ? 'master' : 'bedroom')));
  const bounds = useMemo(() => capBoundsFor(rooms.length), [rooms.length]);
  const [cap, setCap] = useState(() => String(Math.min(bhk, 4)));
  const [err, setErr] = useState('');

  const setRoom = (i, patch) => setRooms((list) => list.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const addRoom = () => setRooms((list) => (list.length < roomCap ? [...list, blankRoom('bedroom')] : list));
  const removeRoom = (i) => setRooms((list) => (list.length > 1 ? list.filter((_, n) => n !== i) : list));

  const capNum = Number(cap) || 0;
  const capValid = capNum >= bounds.min && capNum <= bounds.max;
  const totalRent = rooms.reduce((n, r) => n + (Number(r.rent) || 0), 0);
  const ready = rooms.length > 0 && rooms.every((r) => Number(r.rent) > 0) && capValid;

  const submit = () => {
    if (!rooms.every((r) => Number(r.rent) > 0)) { setErr(t('flatmates.splitErrRent')); return; }
    if (!capValid) { setErr(t('flatmates.splitErrCap', { min: bounds.min, max: bounds.max })); return; }
    setErr('');
    onConfirm({ maxOccupants: capNum, rooms });
  };

  return (
    <div className="sf-modal" onClick={onClose}>
      <div className="glass rounded-3xl w-full max-w-xl p-6 sm:p-7 max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4 gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white">{t('flatmates.splitTitle')}</h2>
            <p className="text-gray-400 text-xs mt-1">{t('flatmates.splitSubtitle')}</p>
          </div>
          <button onClick={onClose} aria-label={t('flatmates.chooserClose')} className="p-2 rounded-xl hover:bg-white/5 text-gray-400 hover:text-white shrink-0"><Icon name="x" className="w-5 h-5" /></button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 mb-4 flex items-center gap-3">
          {listing?.image && <img src={listing.image} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{listing?.title}</p>
            <p className="text-[11px] text-gray-400">{[bhk ? bhk + ' BHK' : '', listing?.locality].filter(Boolean).join(' · ')}</p>
          </div>
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">{t('flatmates.splitRoomsLabel')}</p>
        <div className="space-y-2.5 mb-2">
          {rooms.map((r, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex flex-wrap gap-1.5">
                  {ROOM_KIND_ORDER.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setRoom(i, { roomKind: k })}
                      aria-pressed={r.roomKind === k}
                      className={'seg text-[11px] font-semibold px-2.5 py-1.5 rounded-lg' + (r.roomKind === k ? ' active text-white' : ' text-gray-400')}
                    >{t('flatmates.roomKind_' + k)}</button>
                  ))}
                </div>
                {rooms.length > 1 && (
                  <button type="button" onClick={() => removeRoom(i)} aria-label={t('flatmates.splitRemoveRoom')} className="p-1.5 rounded-lg text-gray-500 hover:text-rose-300 hover:bg-rose-500/10 shrink-0"><Icon name="trash-2" className="w-3.5 h-3.5" /></button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('flatmates.splitRent')}</label>
                  <input inputMode="numeric" value={r.rent} onChange={(e) => setRoom(i, { rent: e.target.value.replace(/\D/g, '').slice(0, 7) })} placeholder="14000" className="field w-full rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('flatmates.splitDeposit')}</label>
                  <input inputMode="numeric" value={r.deposit} onChange={(e) => setRoom(i, { deposit: e.target.value.replace(/\D/g, '').slice(0, 7) })} placeholder={t('flatmates.splitDepositAuto')} className="field w-full rounded-xl px-3 py-2 text-sm" />
                </div>
              </div>
              {ROOM_KINDS[r.roomKind]?.attachedBath && <p className="text-[11px] text-teal-200/80 mt-1.5 inline-flex items-center gap-1"><Icon name="bath" className="w-3 h-3" /> {t('flatmates.splitMasterBath')}</p>}
            </div>
          ))}
        </div>
        {rooms.length < roomCap && (
          <button type="button" onClick={addRoom} className="btn-ghost h-9 inline-flex items-center gap-1.5 px-3.5 rounded-full text-gray-200 text-xs font-semibold mb-4"><Icon name="plus" className="w-3.5 h-3.5" /> {t('flatmates.splitAddRoom')}</button>
        )}
        {Number.isFinite(roomCap) && <p className="text-[11px] text-gray-500 mb-4">{t('flatmates.splitRoomCapNote', { count: roomCap, bhk })}</p>}

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 mb-4">
          <label className="block text-xs font-medium text-gray-300 mb-1">{t('flatmates.splitCapLabel')}</label>
          {/* The owner's only occupancy call. Tenants choose whether to take a room
              alone or split it; this is the ceiling those choices must fit inside. */}
          <p className="text-[11px] text-gray-500 mb-2">{t('flatmates.splitCapHelp', { max: ROOM_SHARE_MAX })}</p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: bounds.max - bounds.min + 1 }, (_, i) => bounds.min + i).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => { setCap(String(n)); setErr(''); }}
                aria-pressed={capNum === n}
                className={'seg text-sm font-semibold w-10 h-10 rounded-xl' + (capNum === n ? ' active text-white' : ' text-gray-400')}
              >{n}</button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-teal-400/25 bg-teal-500/[0.07] px-4 py-3 mb-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-300">{t('flatmates.splitTotalIfFull')}</span>
            <span className="text-base font-bold gradient-text">{totalRent ? inr(totalRent) : '—'}</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">{t('flatmates.splitWholeFlatNote')}</p>
        </div>

        {err && <p className="text-xs text-rose-300 mb-3 inline-flex items-center gap-1.5"><Icon name="alert-circle" className="w-3.5 h-3.5" /> {err}</p>}

        <div className="flex items-center gap-2">
          <button type="button" onClick={submit} disabled={!ready} className="btn-teal flex-1 h-11 inline-flex items-center justify-center gap-2 rounded-xl text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
            <Icon name="layout-grid" className="w-4 h-4" /> {t('flatmates.splitConfirm', { count: rooms.length })}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost h-11 px-4 rounded-xl text-gray-300 text-sm font-medium">{t('flatmates.chooserBack')}</button>
        </div>
      </div>
    </div>
  );
}
