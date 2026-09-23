import { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/Icon.jsx';
import { digits } from '../../../lib/contact.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { applyGroupToListing, myFlatmateGroups } from '../../../services/flatmateService.js';

/* Renders nothing far more often than it renders something: only a signed-in host of a group with
   seats left, on someone else's rental. A failed load renders nothing rather than an error strip. */
export function GroupApplyCard({ p, isIn, toast }) {
  const isRent = p?.deal === 'rent';
  /* `p.id` is the slug (`p5015`) because the property routes accept slug-or-id; `p.uuid` is the
     same row's real key, and the fallback covers rows with no separate one. */
  const listingId = String(p?.uuid || p?.id || '');
  /* `!!mine` is what keeps a signed-out visitor from reading as the owner: without it an empty
     mobile equals an empty `ownerMobile` and every listing stating no owner looks like theirs. */
  const { user } = useAuth();
  const mine = digits(user?.mobile).slice(-10);
  const isOwnListing = !!mine && mine === digits(p?.ownerMobile || '').slice(-10);
  const eligible = isIn && isRent && !isOwnListing && !!listingId;

  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!eligible) { setGroups([]); return undefined; }
    let alive = true;
    myFlatmateGroups({ size: 20 })
      .then((res) => { if (alive) setGroups((res.items || []).filter((g) => (g.seatsLeft ?? g.seatsOpen) > 0)); })
      .catch(() => { if (alive) setGroups([]); })
      .finally(() => undefined);
    return () => { alive = false; };
  }, [eligible, listingId]);

  const apply = useCallback(async (groupId) => {
    /* Guarded twice on purpose: the flag is what stops a second click before React re-renders with
       the disabled button, and the button is what stops the first one being inviting. */
    if (busy) return;
    setBusy(true);
    try {
      await applyGroupToListing(groupId, listingId);
      setDone(true);
      toast('Your group has applied. The owner will see it in their dashboard.', 'success');
    } catch (e) {
      /* The server's sentence verbatim. It says "the owner has it" on a duplicate, which answers
         the question the host actually has — did it land? — where "already applied" would not. */
      toast(e?.message || 'That did not go through. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, listingId, toast]);

  if (!eligible || groups.length === 0) return null;

  if (done) {
    return (
      <div className="glass-card p-4 rounded-2xl">
        <p className="flex items-center gap-2 text-sm text-emerald-300">
          <Icon name="check-circle" className="w-4 h-4 flex-shrink-0" />
          Applied. The owner decides from their dashboard — you will be notified either way.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 rounded-2xl group-apply-card">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-white mb-1">
        <Icon name="users" className="w-4 h-4 text-brand-teal-2" /> Rent this as a group
      </h3>
      <p className="text-xs text-gray-400 mb-3">
        Put your group forward for the whole flat and split the rent. The owner answers from their
        dashboard.
      </p>
      <div className="space-y-2">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            disabled={busy}
            onClick={() => apply(g.id)}
            className="apply-group-btn w-full flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left hover:bg-white/10 disabled:opacity-50 transition-smooth"
          >
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-white">{g.title}</span>
              <span className="block text-[11px] text-gray-400">
                {g.members?.length || 0}/{g.seatsTotal} members
              </span>
            </span>
            <span className="text-[11px] font-semibold text-brand-teal-2 whitespace-nowrap">Apply</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default GroupApplyCard;
