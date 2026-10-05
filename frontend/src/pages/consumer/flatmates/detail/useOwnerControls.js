import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../../context/ToastContext.jsx';
import * as flatmateService from '../../../../services/flatmateService.js';
import { inr, perHead, seatCeiling, seatsLeft } from '../helpers.js';

export function useOwnerControls(kind, item, patch) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  /* Steppers are tapped in bursts; pending stores the target until the server clamps and
   * returns the saved row. */
  const pending = useRef({});
  const fail = (err) => toast(err?.message || t('common.somethingWentWrong'), 'error');

  const step = async (field, want, send) => {
    pending.current[field] = want;
    let saved;
    try {
      saved = await send(want);
    } catch (err) {
      delete pending.current[field];
      fail(err);
      return null;
    }
    if (pending.current[field] === want) delete pending.current[field];
    patch(saved);
    return saved;
  };

  const onSeats = async (delta) => {
    const cur = pending.current.seats ?? seatsLeft(item);
    const next = Math.max(0, Math.min(seatCeiling(kind, item), cur + delta));
    if (next === cur) return;
    const group = kind === 'group';
    const saved = await step('seats', next, (n) => (group ? flatmateService.setGroupSeats(item.id, n) : flatmateService.setRoomSeats(item.id, n)));
    if (!saved) return;
    if (group) { toast(t('flatmates.groupSeatsResized', { count: saved.seatsTotal, share: inr(perHead(saved)) })); return; }
    const applied = saved.seatsOpen ?? next;
    if (delta > 0) toast(t('flatmates.roomSeatReopened'));
    else toast(applied === 0 ? t('flatmates.roomAllFilled') : t('flatmates.seatMarkedFilled'));
  };

  const onPeople = async (delta) => {
    const cur = pending.current.people ?? (Number(item.occupants) || 0);
    const want = cur + delta;
    if (want < 0) return;
    const saved = await step('people', want, (n) => flatmateService.setRoomOccupants(item.id, n));
    if (!saved) return;
    if ((Number(saved.occupants) || 0) === cur) { toast(t('flatmates.roomAtCapacity'), 'info'); return; }
    toast(delta > 0 ? t('flatmates.roomPersonAdded') : t('flatmates.roomPersonRemoved'));
  };

  const onReissue = () => navigate('/services/rent-agreement?flat=' + encodeURIComponent(item.propertyId || item.id) + '&reissue=1');

  const onDelete = async () => {
    if (!window.confirm(t('flatmates.detailDeleteConfirm'))) return;
    try {
      if (kind === 'group') await flatmateService.deleteGroup(item.id);
      else if (kind === 'room') await flatmateService.deleteRoom(item.id);
      else await flatmateService.deletePost(item.id);
    } catch (err) { fail(err); return; }
    toast(t('flatmates.detailDeleted'));
    navigate('/dashboard#listings');
  };

  return { onSeats, onPeople, onReissue, onDelete };
}
