import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import { inr } from './helpers.js';
import { ROOM_KIND_ORDER, ROOM_KINDS } from './model.js';
import { maxRoomsForBhk, capBoundsFor, ROOM_SHARE_MAX, bedroomsOf } from '../../../lib/data/flatSplit.js';

/* The owner answers only what they may decide: which rooms exist, each room's rent, and how many
   people may live in the FLAT. Per-room occupancy is the tenants' call, so it stays emergent. */

const blankRoom = (roomKind) => ({ roomKind, rent: '', deposit: '' });
const digits = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 7);
const grouped = (v) => (v ? Number(v).toLocaleString('en-IN') : '');

export default function SplitFlatModal({ listing, onClose, onConfirm }) {
  const { t } = useTranslation();
  /* Both shapes a listing carries its BHK in. `Number(listing.bhk)` is NaN for "3 BHK", which
     would seed one room and a flat cap of one: a split the owner cannot confirm. */
  const bhk = bedroomsOf(listing?.bhkNum ?? listing?.bhk) || 1;
  const roomCap = maxRoomsForBhk(bhk);
  // Seeded with the flat's bedrooms, leaving the hall an explicit opt-in: letting a partitioned
  // living room is the choice societies and rent agreements most often object to.
  const [rooms, setRooms] = useState(() => Array.from({ length: Math.min(bhk, 4) }, (_, i) => blankRoom(i === 0 ? 'master' : 'bedroom')));
  const bounds = useMemo(() => capBoundsFor(rooms.length), [rooms.length]);
  const [cap, setCap] = useState(() => String(Math.min(bhk, 4)));

  const setRoom = (i, patch) => setRooms((list) => list.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const addRoom = () => setRooms((list) => (list.length < roomCap ? [...list, blankRoom('bedroom')] : list));
  const removeRoom = (i) => setRooms((list) => (list.length > 1 ? list.filter((_, n) => n !== i) : list));

  const capNum = Number(cap) || 0;
  const capValid = capNum >= bounds.min && capNum <= bounds.max;
  const totalRent = rooms.reduce((n, r) => n + (Number(r.rent) || 0), 0);
  /* Derived, not stored in state: confirm is disabled until both hold, so a stored error could
     only ever be shown by a path that cannot be reached — say what is missing instead. */
  const blocker = !rooms.every((r) => Number(r.rent) > 0)
    ? t('flatmates.splitErrRent')
    : !capValid ? t('flatmates.splitErrCap', { min: bounds.min, max: bounds.max }) : '';
  const ready = rooms.length > 0 && !blocker;

  const submit = () => { if (ready) onConfirm({ maxOccupants: capNum, rooms }); };

  const footer = (
    <>
      {blocker && (
        <p className="w-full text-left text-[11px] text-gray-400 inline-flex items-center gap-1.5">
          <Icon name="info" className="w-3.5 h-3.5 shrink-0" /> {blocker}
        </p>
      )}
      <button type="button" onClick={onClose} className="btn btn-secondary">{t('flatmates.modalBack')}</button>
      <button type="button" onClick={submit} disabled={!ready} className="btn btn-primary flex-1 sm:flex-none">
        <Icon name="layout-grid" className="w-4 h-4" /> {t('flatmates.splitConfirm', { count: rooms.length })}
      </button>
    </>
  );

  return (
    <Modal open onClose={onClose} title={t('flatmates.splitTitle')} size="lg" footer={footer}>
      <p className="text-xs text-gray-400 leading-relaxed">{t('flatmates.splitSubtitle')}</p>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 flex items-center gap-3">
        {listing?.image && <img src={listing.image} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{listing?.title}</p>
          <p className="text-[11px] text-gray-400">{[bhk ? bhk + ' BHK' : '', listing?.locality].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      <p className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{t('flatmates.splitRoomsLabel')}</p>
      <div className="space-y-3">
        {rooms.map((r, i) => (
          <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white shrink-0">{t('flatmates.splitRoomN', { n: i + 1 })}</span>
              {rooms.length > 1 && (
                <button type="button" onClick={() => removeRoom(i)} aria-label={t('flatmates.splitRemoveRoom')} className="tap-target -mr-1.5 inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-rose-300 hover:bg-rose-500/10 sm:min-h-0 sm:min-w-0 sm:p-1.5">
                  <Icon name="trash-2" className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {ROOM_KIND_ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setRoom(i, { roomKind: k })}
                  aria-pressed={r.roomKind === k}
                  className={'seg inline-flex items-center justify-center gap-1 px-3 rounded-lg text-[11px] font-semibold' + (r.roomKind === k ? ' active text-white' : ' text-gray-400')}
                >
                  {r.roomKind === k && <Icon name="check" className="w-3 h-3" />}
                  {t('flatmates.roomKind_' + k)}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor={`split-rent-${i}`} className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('flatmates.splitRent')}</label>
                <div className="relative">
                  <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">₹</span>
                  <input id={`split-rent-${i}`} inputMode="numeric" value={grouped(r.rent)} onChange={(e) => setRoom(i, { rent: digits(e.target.value) })} placeholder="14,000" className="field w-full rounded-xl pl-7 pr-3 h-11 text-sm" />
                </div>
              </div>
              <div>
                <label htmlFor={`split-deposit-${i}`} className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">{t('flatmates.splitDeposit')}</label>
                <div className="relative">
                  <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">₹</span>
                  {/* Once a rent exists, the "2× rent" convention can be shown as the number it
                      means, so leaving the box empty is an informed choice rather than a blank. */}
                  <input id={`split-deposit-${i}`} inputMode="numeric" value={grouped(r.deposit)} onChange={(e) => setRoom(i, { deposit: digits(e.target.value) })} placeholder={r.rent ? grouped(Number(r.rent) * 2) : t('flatmates.splitDepositAuto')} className="field w-full rounded-xl pl-7 pr-3 h-11 text-sm" />
                </div>
              </div>
            </div>

            {ROOM_KINDS[r.roomKind]?.attachedBath && (
              <p className="mt-2 text-[11px] text-teal-200/80 inline-flex items-center gap-1"><Icon name="bath" className="w-3 h-3" /> {t('flatmates.splitMasterBath')}</p>
            )}
          </div>
        ))}
      </div>

      {rooms.length < roomCap && (
        <button type="button" onClick={addRoom} className="btn btn-secondary btn-sm mt-3 rounded-full text-xs">
          <Icon name="plus" className="w-3.5 h-3.5" /> {t('flatmates.splitAddRoom')}
        </button>
      )}
      {Number.isFinite(roomCap) && <p className="mt-2 text-[11px] text-gray-500">{t('flatmates.splitRoomCapNote', { count: roomCap, bhk })}</p>}

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
        <p id="split-cap-label" className="text-xs font-medium text-gray-300">{t('flatmates.splitCapLabel')}</p>
        {/* The owner's only occupancy call. Tenants choose whether to take a room
            alone or split it; this is the ceiling those choices must fit inside. */}
        <p className="mt-1 mb-2.5 text-[11px] text-gray-500 leading-relaxed">{t('flatmates.splitCapHelp', { max: ROOM_SHARE_MAX })}</p>
        <div role="group" aria-labelledby="split-cap-label" className="flex flex-wrap gap-2">
          {Array.from({ length: bounds.max - bounds.min + 1 }, (_, i) => bounds.min + i).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCap(String(n))}
              aria-pressed={capNum === n}
              /* `.seg` is emitted after Tailwind's utilities, so it owns the height and centres
                 nothing on a fine pointer — size by min-width, centre explicitly. */
              className={'seg inline-flex items-center justify-center min-w-[2.75rem] px-3 rounded-xl text-sm font-semibold' + (capNum === n ? ' active text-white' : ' text-gray-400')}
            >{n}</button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-teal-400/25 bg-teal-500/[0.07] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-300">{t('flatmates.splitTotalIfFull')}</span>
          <span className={'text-base font-bold ' + (totalRent ? 'gradient-text' : 'text-gray-500')}>{inr(totalRent)}</span>
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400 leading-relaxed">{t('flatmates.splitWholeFlatNote')}</p>
      </div>
    </Modal>
  );
}
