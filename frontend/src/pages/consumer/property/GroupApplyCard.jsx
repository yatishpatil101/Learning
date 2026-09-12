import { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/Icon.jsx';
import { digits } from '../../../lib/contact.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { applyGroupToListing, myFlatmateGroups } from '../../../services/flatmateService.js';

/**
 * "Apply as a group" on a rental listing.
 *
 * ## What this is the missing half of
 *
 * The ops desk has always had a group-applications board, and until now nothing in the product
 * could put a row on it — no route created an application, so the board was a correct, guarded,
 * paged read over a table that could never acquire a row. This is the entry point that fills it:
 * a formed group commits itself to a whole flat, and the flat's owner answers from their dashboard
 * inbox. Two people, one row, two separate columns (`status` is the owner's, `modStatus` is ops').
 *
 * ## Why it renders nothing far more often than it renders something
 *
 * The button is for one narrow person: someone who *hosts* a group that still has seats to fill,
 * looking at someone else's rental listing. Everyone else — buyers, owners viewing their own flat,
 * anyone browsing a sale listing, signed-out visitors — gets nothing at all rather than a disabled
 * control explaining a workflow they are not in. A control that cannot be used teaches nothing; it
 * only takes up the place where the next real action would have been.
 *
 * So the load is deliberately quiet. It runs once, only when signed in and only on a rental, and a
 * failure renders nothing rather than an error strip: the caller did not ask for this panel, and
 * "we could not check whether you host a group" is not information anyone came here for. That is
 * the opposite of the dashboard inbox's rule, and correctly so — there, an empty list is a claim
 * about the owner's business and must not be made from a failed request.
 *
 * ## Which listings
 *
 * Rentals only, and the server agrees (400 on a sale listing). On a sale listing `price` is the
 * whole consideration rather than a monthly figure, so the per-head number the owner's inbox shows
 * would be wrong by orders of magnitude — the kind of wrong that looks like a real offer.
 */
export function GroupApplyCard({ p, isIn, toast }) {
  const isRent = p?.deal === 'rent';
  /* The listing routes take the row's real key. `p.id` is the slug (`p5015`) because the property
     routes accept slug-or-id and a slug makes a prettier URL; `p.uuid` is the same row's uuid, and
     the fallback covers mock listings, which have no separate one. Same reasoning as DealPanel. */
  const listingId = String(p?.uuid || p?.id || '');
  /* Who is signed in is a question for the session, so it is asked of the auth context rather than
     of storage — the same answer every other gate on this page is drawn from, and one that cannot
     disagree with the header while a stale cached number sits in localStorage.

     `mine` is empty whenever nobody is signed in, and the `!!mine` guard is what keeps that from
     reading as ownership: without it an empty mobile equals an empty `ownerMobile` and every
     listing that states no owner would look like this visitor's own. */
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
