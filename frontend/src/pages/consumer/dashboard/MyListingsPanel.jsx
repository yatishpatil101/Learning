import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Select from '../../../components/ui/Select.jsx';
import Icon from '../../../components/Icon.jsx';
import { setListingStatus, confirmListingFresh, confirmOwnerListing, takeListingDown, pauseListing, resumeListing } from '../../../services/propertyService.js';
import { deleteGroup, deletePost, deleteRoom, myFlatmateRooms, renewFlatmate, splitProperty, unsplitProperty } from '../../../services/flatmateService.js';
import { closeDeal, reopenDeal, reserveDeal, myDeals } from '../../../services/dealService.js';
import { myContactRequests } from '../../../services/contactService.js';
import { loadOwnerProperties } from '../../../lib/data/ownerProperties.js';
import { publishManaged, deleteManaged, ensureManagedForListing } from '../../../services/managedService.js';
import { listingFreshness } from '../../../lib/freshness.js';
import { loadListingQuota } from '../../../lib/data/listingQuota.js';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { Card, SectionHead } from './components.jsx';
import AttentionBanner from './myListings/AttentionBanner.jsx';
import EmptyState from './myListings/EmptyState.jsx';
import PrivateListingCard from './myListings/PrivateListingCard.jsx';
import ListingCard from './myListings/ListingCard.jsx';
import FinalizeDealModal from './myListings/FinalizeDealModal.jsx';
import VerifyListingsBanner from './myListings/VerifyListingsBanner.jsx';
import SplitFlatModal from '../flatmates/SplitFlatModal.jsx';
import { useFlatmateEditing } from './myListings/useFlatmateEditing.jsx';

export default function MyListingsPanel({ listings, user, toast, openReview, reviewsByProp, onChanged }) {
  const { t } = useTranslation();
  /* Full My Listings tab with lifecycle actions: Mark Under Offer, Finalize, Reopen, Edit, Delete */
  const [listingsState, setListingsState] = useState(listings);
  const [showDealModal, setShowDealModal] = useState(null);
  // The rent listing the owner is carving into rooms, if any.
  const [splitTarget, setSplitTarget] = useState(null);
  const [dealForm, setDealForm] = useState({ buyerName: '', buyerMobile: '', finalPrice: '', date: new Date().toISOString().slice(0, 10) });
  const { flagEnabled } = useAppFlags();
  const navigate = useNavigate();
  // Real per-listing leads = buyers who requested this owner's contact for that
  // property. Refetched when the list changes so counts stay in sync after actions.
  const [contactReqs, setContactReqs] = useState([]);
  useEffect(() => {
    let alive = true;
    if (!user?.mobile) { setContactReqs([]); return undefined; }
    myContactRequests()
      /* Lead counts are decoration here; the listing actions beside them are the point. */
      // A failed count renders as zero rather than blanking the owner's listings.
      .then((res) => alive && setContactReqs(res.items))
      .catch(() => alive && setContactReqs([]));
    return () => { alive = false; };
  }, [user, listingsState]);
  const leadsFor = useCallback(
    (id) => contactReqs.filter((r) => String(r.propertyId) === String(id) && String(r.status || '').toLowerCase() === 'pending').length,
    [contactReqs],
  );
  /* One owner-scoped read of the whole deal book, so per-card lookups do not become one request per row. */

  const listingKey = useMemo(
    () => listingsState.map((l) => l.uuid || l.id).join(','),
    [listingsState],
  );
  const [dealsByProp, setDealsByProp] = useState({});
  const refreshDeals = useCallback(async (key) => {
    // No listings, nothing to ask about. The panel mounts before `loadOwnerProperties` resolves, so
    // without this the first render spends a request to be told the caller's empty book is empty.
    if (!key) { setDealsByProp({}); return; }
    try {
      const rows = await myDeals();
      const map = {};
      (rows || []).forEach((d) => { map[String(d.propId)] = d.status; });
      setDealsByProp(map);
    } catch {
      // A card whose deal state is unknown renders its listing status, which is the pre-deal truth.
      setDealsByProp({});
    }
  }, []);
  /* Keyed by UUID: `/me/deals` returns `propertyId` as the real key, while a listing's `id` in the seam is its slug. */
  useEffect(() => { refreshDeals(listingKey); }, [refreshDeals, listingKey]);
  const dealStatusOf = useCallback(
    (l) => dealsByProp[String(l.uuid || l.id)] || 'active',
    [dealsByProp],
  );
  /* One owner-scoped read for the whole page: `propertyRooms(id)` per card would be twenty requests to draw one chip. */

  const [splitByProp, setSplitByProp] = useState({});
  const refreshSplits = useCallback(async (key) => {
    if (!key) { setSplitByProp({}); return; }
    try {
      const page = await myFlatmateRooms({ size: 200 });
      const map = {};
      (page?.items || []).forEach((room) => {
        if (!room.propertyId) return;
        const at = map[String(room.propertyId)] || { rooms: 0, movedIn: 0 };
        at.rooms += 1;
        at.movedIn += Number(room.occupants) || 0;
        map[String(room.propertyId)] = at;
      });
      setSplitByProp(map);
    } catch {
      // Unknown split state renders as "not split", which is the pre-split truth and leaves the
      // owner an action rather than a chip they cannot act on.
      setSplitByProp({});
    }
  }, []);
  useEffect(() => { refreshSplits(listingKey); }, [refreshSplits, listingKey]);
  const splitOf = useCallback(
    (l) => splitByProp[String(l.uuid || l.id)] || null,
    [splitByProp],
  // Paid owner plans toggle featuring themselves; free plans see an upsell. `isPaidOwner` is false
  // until a subscription is active, so an abandoned checkout never hands out a paid tool.
  );
  const featuringOn = flagEnabled('paidFeaturedListings');

    // loadOwnerProperties also runs the managed-record bridge (a write), so guard
    // against a storage failure leaving the list stuck on stale/empty data.
  const refreshListings = useCallback(async ({ notifyParent = false } = {}) => {
    try {
      const next = await loadOwnerProperties(user);
      setListingsState(next);
      if (notifyParent) await onChanged?.();
    } catch (err) {
      console.error('Failed to load properties', err);
    }
  }, [onChanged, user]);

  useEffect(() => { refreshListings(); }, [refreshListings]);
  const flatmateEditing = useFlatmateEditing({
    user, toast, refresh: () => refreshListings({ notifyParent: true }),
  });

  const [quota, setQuota] = useState({ used: 0, allowance: null });
  useEffect(() => {
    let live = true;
    loadListingQuota(user)
      .then((next) => { if (live) setQuota(next); })
      .catch(() => { if (live) setQuota({ used: 0, allowance: null }); });
    return () => { live = false; };
  }, [user, listingsState]);
  // Categorize each item so the type filter can group properties, flatmate rooms,
  // flatmate requests and flatmate groups — the things a user can post.

  const catOf = (l) => (l.flatmateGroup ? 'group' : l.flatmatePost ? 'request' : l.flatmate ? 'room' : 'property');
  const counts = useMemo(() => {
    const c = { all: listingsState.length, property: 0, room: 0, request: 0, group: 0 };
    listingsState.forEach((l) => c[catOf(l)]++);
    return c;
  }, [listingsState]);
  // Total across live properties (ADR-019 C2), so the verify nudge can attach to real interest
  // rather than a generic pitch.

  const totalEnquiries = useMemo(
    () => listingsState.reduce((s, l) => (catOf(l) === 'property' ? s + (Number(l.enquiries) || 0) : s), 0),
    [listingsState],
  );

  const [typeFilter, setTypeFilter] = useState('all');
  // Only surface filter options the user actually has something in.
  const filterOptions = useMemo(() => {
    const defs = [
      { value: 'all', label: 'All types', icon: 'layout-grid', badge: counts.all },
      { value: 'property', label: 'Properties', icon: 'building-2', badge: counts.property, n: counts.property },
      { value: 'room', label: 'Flatmate rooms', icon: 'bed-double', badge: counts.room, n: counts.room },
      { value: 'request', label: 'Flatmate requests', icon: 'user-search', badge: counts.request, n: counts.request },
      { value: 'group', label: 'Flatmate groups', icon: 'users-round', badge: counts.group, n: counts.group },
    ];
    return defs.filter((o) => o.value === 'all' || o.n > 0);
  }, [counts]);
  // Reset to "all" when the active filter has no items left, e.g. after a delete.

  useEffect(() => {
    if (typeFilter !== 'all' && !filterOptions.some((o) => o.value === typeFilter)) setTypeFilter('all');
  }, [filterOptions, typeFilter]);

  const visibleListings = useMemo(
    () => (typeFilter === 'all' ? listingsState : listingsState.filter((l) => catOf(l) === typeFilter)),
    [listingsState, typeFilter],
  );
  /* The deal routes take the property's UUID; `l.id` in the seam is its slug. See `dealStatusOf`. */

  const dealIdOf = (l) => String(l.uuid || l.id);

  const handleMarkUnderOffer = async (l) => {
    try {
      await reserveDeal(dealIdOf(l));
      toast(`${l.title} marked as Under Offer`, 'success');
      await refreshDeals(listingKey);
      await refreshListings({ notifyParent: true });
    } catch (err) {
      toast(err?.body?.error || err?.message || 'Could not mark under offer', 'error');
    }
  };

  const openFinalizeModal = (l) => {
    setShowDealModal(l);
    setDealForm({ buyerName: '', buyerMobile: '', finalPrice: l.price || '', date: new Date().toISOString().slice(0, 10) });
  };

  const handleFinalize = async () => {
    if (!showDealModal) return;
    const l = showDealModal;
    const isSale = l.deal === 'buy' || l.deal === 'sale';
    try {
      // The server requires a positive agreed price and the counterparty's real ten-digit mobile,
      // refusing a masked number; this modal is the only place that collects both.
      await closeDeal(dealIdOf(l), {
        agreedPrice: parseFloat(dealForm.finalPrice) || l.price,
        counterpartyMobile: dealForm.buyerMobile,
        note: dealForm.buyerName ? `Closed with ${dealForm.buyerName} on ${dealForm.date}` : undefined,
      });
    } catch (err) {
      toast(err?.body?.error || err?.message || 'Could not finalize the deal', 'error');
      return;
    }
    // `sold`/`rented` are not server statuses (the column allows pending|approved|rejected|flagged|
    // archived), so the listing's own state stays a local mark the API would otherwise reject.
    setListingStatus(l.id, isSale ? 'sold' : 'rented');
    toast(`${l.title} finalized as ${isSale ? 'Sold' : 'Rented'}!`, 'success');
    setShowDealModal(null);
    await refreshDeals(listingKey);
    await refreshListings({ notifyParent: true });
  };

  const handleReopen = async (l) => {
    try {
      /* Awaited, unlike the `sold`/`rented` mark above, because this one can be refused: the server will not return a
         listing to `approved` while it has no locality. */
      await reopenDeal(dealIdOf(l));
      await setListingStatus(l.id, 'approved');
    } catch (err) {
      toast(err?.body?.error || err?.message || 'Could not reopen the listing', 'error');
      return;
    }
    toast(`${l.title} reopened for listing`, 'success');
    await refreshDeals(listingKey);
    await refreshListings({ notifyParent: true });
  };
  /* Carve a live rent listing into per-room supply through the seam, so the rooms reach seekers rather than one
     browser's localStorage. */

  const handleSplitConfirm = async ({ maxOccupants, rooms }) => {
    let created;
    try {
      created = await splitProperty(splitTarget?.uuid || splitTarget?.id, { maxOccupants, rooms });
    } catch (err) {
      toast(err?.body?.error || err?.message || 'Could not list the rooms — please check the details.', 'error');
      return;
    }
    setSplitTarget(null);
    const count = created?.rooms?.length || rooms.length;
    const unbadged = (created?.rooms || []).some((r) => !r.verified);
    toast(
      unbadged
        ? `${count} room${count > 1 ? 's' : ''} listed — they'll show as owner-verified once this property is approved.`
        : `${count} room${count > 1 ? 's' : ''} listed in Flatmates`,
      'success',
    );
    await refreshSplits(listingKey);
    await refreshListings({ notifyParent: true });
  };
  /* Undoing a split is one decision about a flat, not a stack of per-room deletes — the per-room withdraw answers 409
     `split_room` for exactly that reason. */

  const handleUnsplit = async (l) => {
    try {
      await unsplitProperty(l.uuid || l.id);
    } catch (err) {
      toast(
        err?.status === 409
          ? 'Someone has already moved in, so these rooms can\'t be withdrawn.'
          : err?.body?.error || err?.message || 'Could not withdraw these rooms',
        'error',
      );
      return;
    }
    toast(`${l.title} is no longer let room by room`, 'info');
    await refreshSplits(listingKey);
    await refreshListings({ notifyParent: true });
  };
  // The confirmation is stamped server-side and freshness is derived from that instant on read, so
  // refreshing the list is all there is to do.

  const handleConfirmFresh = async (l) => {
    await confirmListingFresh(l.id);
    toast(`"${l.title}" confirmed as available`, 'success');
    await refreshListings({ notifyParent: true });
  };

  const handleConfirmListing = async (l) => {
    try {
      await confirmOwnerListing(l.uuid || l.id);
      toast(`Thanks — "${l.title}" is now with our review team`, 'success');
      await refreshListings({ notifyParent: true });
    } catch (err) {
      toast(err?.body?.message || err?.message || 'Could not confirm this listing', 'error');
    }
  };

  const handlePause = async (l) => {
    if (!window.confirm(t('listingLifecycle.pauseConfirm', { title: l.title }))) return;
    try {
      await pauseListing(l.uuid || l.id);
      toast(t('listingLifecycle.pauseToast', { title: l.title }), 'info');
      await refreshListings({ notifyParent: true });
    } catch (err) {
      toast(err?.body?.message || err?.message || t('listingLifecycle.pauseError'), 'error');
    }
  };

  const handleRenew = async (kind, l) => {
    try {
      await renewFlatmate(kind, l.id);
      toast(`"${l.title}" is back on the board for 30 days`, 'success');
      await refreshListings({ notifyParent: true });
    } catch (err) {
      toast(err?.body?.message || err?.message || 'Could not renew this post', 'error');
    }
  };

  const handleResume = async (l) => {
    try {
      await resumeListing(l.uuid || l.id);
      toast(t('listingLifecycle.resumeToast', { title: l.title }), 'success');
      await refreshListings({ notifyParent: true });
    } catch (err) {
      toast(err?.body?.message || err?.message || t('listingLifecycle.resumeError'), 'error');
    }
  };

  const handleShare = async (l, viewHref) => {
    const url = `${window.location.origin}${viewHref}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: l.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast(t('owner.listingStatus.shareCopied', { defaultValue: 'Listing link copied' }), 'success');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') toast('Could not share this listing. Please try again.', 'error');
    }
  };

  const handleOpenTools = async (l) => {
    if (l.managedId) {
      navigate(`/owner-hub/property/${l.managedId}`);
      return;
    }
    try {
      const managed = await ensureManagedForListing(l);
      if (!managed?.id) throw new Error('Could not open property tools for this listing.');
      await refreshListings({ notifyParent: true });
      navigate(`/owner-hub/property/${managed.id}`);
    } catch (err) {
      toast(err?.message || 'Could not open property tools. Please try again.', 'error');
    }
  };
  // Sequential rather than `Promise.all`: a burst of writes from one owner is exactly the shape
  // that trips a rate limiter on the action the platform most wants owners to perform.

  const handleConfirmAll = async () => {
    const stale = listingsState.filter((l) => !l.flatmate && listingFreshness(l).owner.cta);
    for (const l of stale) await confirmListingFresh(l.id);
    toast(`${stale.length} listing${stale.length === 1 ? '' : 's'} confirmed as available`, 'success');
    await refreshListings({ notifyParent: true });
  };
  /* No WhatsApp chaser here: `POST /properties/{id}/outreach` 403s for an owner deliberately, since outreach is the
     platform speaking *to* an owner — handing owners a message from us, to them, to send to themselves. */

  // Listings (properties only) that need the owner's attention, for the nudge banner.

  const attentionListings = useMemo(
    () => listingsState.filter((l) => !l.flatmate && listingFreshness(l).owner.cta),
    [listingsState],
  );
  const dormantCount = useMemo(
    () => listingsState.filter((l) => !l.flatmate && listingFreshness(l).state === 'dormant').length,
    [listingsState],
  );
  /* The branches are not interchangeable: a room is withdrawn through its own endpoint, which can 409 when its flat
     shares one occupancy ledger — a refusal that has to reach the owner as words. */

  const handleDelete = async (l) => {
    if (!window.confirm(`Take "${l.title}" down? Buyers will stop seeing it.`)) return;

    try {
      if (l.private) await deleteManaged(l.managedId);
      else if (l.flatmateGroup) await deleteGroup(l.id);
      else if (l.flatmatePost) await deletePost(l.id);
      else if (l.flatmate) await deleteRoom(l.id);
      else await takeListingDown(l.uuid || l.id, user);
    } catch (e) {
      toast(e?.message || `Could not take ${l.title} down. Please try again.`, 'error');
      return;
    }

    toast(`${l.title} taken down`, 'info');
    await refreshListings({ notifyParent: true });
  };
  /* Publish a managed-only property into the pending-review flow. */

  const handlePublish = async (l) => {
    let res;
    try {
      res = await publishManaged(l.managedId);
    } catch (e) {
      toast(e?.message || 'Could not publish this property. Please check its details.', 'error');
      return;
    }
    if (res?.already) { toast('This property is already listed.', 'info'); return; }
    toast('Submitted for review — buyers will see it once verified.', 'success');
    await refreshListings({ notifyParent: true });
  };

  return (
    <>
      <Card className="px-3 py-4 sm:p-6">
        <SectionHead
          icon="building-2"
          title="My properties"
          sub="Everything you own or posted — private tools, live listings, flatmate rooms and flatmate posts, all in one place."
          action={
            filterOptions.length > 1 && (
              <div className="w-full sm:w-[13rem]" style={{ '--dd-sm-w': '100%' }}>
                <Select
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={filterOptions}
                  size="sm"
                  className="dd-type-filter"
                  prefix="Type"
                  ariaLabel="Filter listings by type"
                />
              </div>
            )
          }
        />
        {quota.allowance != null && (
          <p className="-mt-2 mb-4 flex items-center gap-1.5 text-xs font-medium text-gray-400">
            <Icon name="info" className="w-3.5 h-3.5 flex-shrink-0 text-teal-400" />
            {quota.used > 0
              ? t('listingLifecycle.quotaUsed', { used: quota.used, allowance: quota.allowance })
              : t('listingLifecycle.quotaAvailable', { allowance: quota.allowance })}
          </p>
        )}
        {attentionListings.length > 0 && (
          <AttentionBanner attentionListings={attentionListings} dormantCount={dormantCount} onConfirmAll={handleConfirmAll} />
        )}
        {counts.property > 0 && <VerifyListingsBanner enquiryCount={totalEnquiries} />}
        {listingsState.length === 0 ? (
          <EmptyState />
        ) : visibleListings.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">Nothing in this category yet. Try a different type.</p>
        ) : (
          <div className="space-y-4">
            {visibleListings.map((l) => (
              l.private ? (
                <PrivateListingCard
                  key={l.id}
                  l={l}
                  onPublish={handlePublish}
                  onDelete={handleDelete}
                />
              ) : (
                <ListingCard
                  key={l.id}
                  l={l}
                  dealStatus={dealStatusOf(l)}
                  split={splitOf(l)}
                  review={reviewsByProp?.get(l.id) || null}
                  leadsFor={leadsFor}
                  featuringOn={featuringOn}
                  navigate={navigate}
                  openReview={openReview}
                  onConfirmFresh={handleConfirmFresh}
                  onConfirmListing={handleConfirmListing}
                  onReopen={handleReopen}
                  onMarkUnderOffer={handleMarkUnderOffer}
                  onFinalize={openFinalizeModal}
                  onDelete={handleDelete}
                  onSplit={setSplitTarget}
                  onUnsplit={handleUnsplit}
                  onPause={handlePause}
                  onResume={handleResume}
                  onShare={handleShare}
                  onOpenTools={handleOpenTools}
                  onEditGroup={flatmateEditing.editGroup}
                  onEditPost={flatmateEditing.editPost}
                  onRenew={handleRenew}
                  t={t}
                />
              )
            ))}
          </div>
        )}
      </Card>
      {/* Finalize Deal Modal */}

      {showDealModal && (
        <FinalizeDealModal
          listing={showDealModal}
          dealForm={dealForm}
          setDealForm={setDealForm}
          onFinalize={handleFinalize}
          onClose={() => setShowDealModal(null)}
        />
      )}
      {/* Let this flat room by room */}

      {splitTarget && (
        <SplitFlatModal
          listing={splitTarget}
          onClose={() => setSplitTarget(null)}
          onConfirm={handleSplitConfirm}
        />
      )}

      {flatmateEditing.modals}
    </>
  );
}
