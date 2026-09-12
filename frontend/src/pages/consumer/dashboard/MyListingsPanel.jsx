import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import Select from '../../../components/ui/Select.jsx';
import { setListingStatus, toggleFeatured, confirmListingFresh, takeListingDown } from '../../../services/propertyService.js';
import { deleteRoom, myFlatmateRooms, splitProperty, unsplitProperty } from '../../../services/flatmateService.js';
import { closeDeal, reopenDeal, reserveDeal, myDeals } from '../../../services/dealService.js';
import { deleteFlatmatePost, deleteFlatmateGroup } from '../../../lib/data/flatmates.js';
import { myContactRequests } from '../../../services/contactService.js';
import { loadOwnerProperties } from '../../../lib/data/ownerProperties.js';
import { publishManaged, deleteManaged } from '../../../services/managedService.js';
import { listingFreshness } from '../../../lib/freshness.js';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { usePlan } from '../../../context/PlanContext.jsx';
import { Card, SectionHead } from './components.jsx';
import AttentionBanner from './myListings/AttentionBanner.jsx';
import EmptyState from './myListings/EmptyState.jsx';
import PrivateListingCard from './myListings/PrivateListingCard.jsx';
import ListingCard from './myListings/ListingCard.jsx';
import FinalizeDealModal from './myListings/FinalizeDealModal.jsx';
import VerifyListingsBanner from './myListings/VerifyListingsBanner.jsx';
import SplitFlatModal from '../flatmates/SplitFlatModal.jsx';

export default function MyListingsPanel({ listings, user, toast, openReview, reviewsByProp }) {
  /* Full My Listings tab with lifecycle actions: Mark Under Offer, Finalize, Reopen, Edit, Delete */
  const [listingsState, setListingsState] = useState(listings);
  const [showDealModal, setShowDealModal] = useState(null);
  // The rent listing the owner is carving into rooms, if any.
  const [splitTarget, setSplitTarget] = useState(null);
  const [dealForm, setDealForm] = useState({ buyerName: '', buyerMobile: '', finalPrice: '', date: new Date().toISOString().slice(0, 10) });
  const { flagEnabled } = useAppFlags();
  const { isPaidOwner } = usePlan();
  const navigate = useNavigate();
  // Real per-listing leads = buyers who requested this owner's contact for that
  // property. Refetched when the list changes so counts stay in sync after actions.
  const [contactReqs, setContactReqs] = useState([]);
  useEffect(() => {
    let alive = true;
    if (!user?.mobile) { setContactReqs([]); return undefined; }
    myContactRequests()
      .then((res) => alive && setContactReqs(res.items))
      // Lead counts are decoration on this panel; the listing actions beside them are the point.
      // A failed count renders as zero rather than blanking the owner's listings.
      .catch(() => alive && setContactReqs([]));
    return () => { alive = false; };
  }, [user, listingsState]);
  const leadsFor = useCallback(
    (id) => contactReqs.filter((r) => r.propertyId === id).length,
    [contactReqs],
  );

  /* Deal state for every listing on this panel, as one owner-scoped read.

     `/me/deals` returns the caller's whole book in a single request, so the per-card lookups this
     replaces (`isDealClosed(owner, id)` per row) collapse into one call rather than becoming one
     request per card — the same reasoning the shortlist uses for hearts.

     Keyed on the *ids*, not on `listingsState` itself: that array is rebuilt on every refresh, so
     depending on its identity re-fetched the whole book four times per dashboard load. Which is
     the N+1 this was written to avoid, arrived at from the other direction. */
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
  useEffect(() => { refreshDeals(listingKey); }, [refreshDeals, listingKey]);
  /* Keyed by UUID: `/me/deals` returns `propertyId` as the real key, while a listing's `id` in the
     seam is its slug. Looking up by `l.id` would miss every curated listing. */
  const dealStatusOf = useCallback(
    (l) => dealsByProp[String(l.uuid || l.id)] || 'active',
    [dealsByProp],
  );

  /* Split state for every listing on this panel, as one owner-scoped read.
   *
   * Same shape and the same reasoning as the deal book above: `GET /me/flatmate-rooms` returns
   * every room this host has, split rooms included, so one request answers "is this flat let room
   * by room, how many rooms, and has anyone moved in" for the whole page. `propertyRooms(id)` would
   * answer it per card, which on a twenty-listing dashboard is twenty requests to draw one chip.
   *
   * This is the read the card used to do for itself, synchronously, out of `lib/data/flatSplit.js`
   * — a `localStorage` key the server has never written to. A split performed through the API
   * therefore never reached the dashboard at all: the owner carved up their flat, the rooms
   * appeared on Flatmates for seekers, and their own listing card went on saying nothing had
   * happened. Not a rendering bug; the card was reading a different database.
   *
   * Keyed by UUID for the reason `dealStatusOf` states — `FlatmateRoom.propertyId` is the real
   * property key and a listing's `id` in the seam is its slug.
   */
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
  );
  // Featuring is a paid promotion: paid owner plans can toggle it themselves;
  // free plans see an upsell. The whole capability can be switched off in Settings.
  // `isPaidOwner` is false until a subscription is *active* — a pending payment does not
  // unlock promotion, or an abandoned checkout would hand out a paid tool for free.
  const canFeature = isPaidOwner;
  const featuringOn = flagEnabled('paidFeaturedListings');

  const refreshListings = useCallback(() => {
    // loadOwnerProperties also runs the managed-record bridge (a write), so guard
    // against a storage failure leaving the list stuck on stale/empty data.
    loadOwnerProperties(user)
      .then(setListingsState)
      .catch((err) => { console.error('Failed to load properties', err); });
  }, [user]);

  useEffect(() => { refreshListings(); }, [refreshListings]);

  // Categorize each item so the type filter can group properties, flatmate rooms,
  // flatmate requests and flatmate groups — the things a user can post.
  const catOf = (l) => (l.flatmateGroup ? 'group' : l.flatmatePost ? 'request' : l.flatmate ? 'room' : 'property');
  const counts = useMemo(() => {
    const c = { all: listingsState.length, property: 0, room: 0, request: 0, group: 0 };
    listingsState.forEach((l) => c[catOf(l)]++);
    return c;
  }, [listingsState]);

  // C2 (ADR-019): total enquiries across this owner's live properties. When they already
  // have real interest, the verify nudge attaches to that value moment ("verified owners get
  // 3× more genuine enquiries") instead of a generic pitch. Mock uses the per-listing count;
  // moves to a backend aggregate later.
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

  // Reset to "all" if the active filter no longer has any items (e.g. after delete).
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
      refreshListings();
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
      // and refuses a masked number outright. This modal is the only place in the app that collects
      // both, which is why the property page now routes owners here to close a deal.
      await closeDeal(dealIdOf(l), {
        agreedPrice: parseFloat(dealForm.finalPrice) || l.price,
        counterpartyMobile: dealForm.buyerMobile,
        note: dealForm.buyerName ? `Closed with ${dealForm.buyerName} on ${dealForm.date}` : undefined,
      });
    } catch (err) {
      toast(err?.body?.error || err?.message || 'Could not finalize the deal', 'error');
      return;
    }
    // The listing's own status is a separate domain and a separate decision. `sold`/`rented` are
    // not server statuses (the column allows pending|approved|rejected|flagged|archived), so this
    // stays a local mark rather than a write the API would reject — see the D-item.
    setListingStatus(l.id, isSale ? 'sold' : 'rented');
    toast(`${l.title} finalized as ${isSale ? 'Sold' : 'Rented'}!`, 'success');
    setShowDealModal(null);
    await refreshDeals(listingKey);
    refreshListings();
  };

  const handleReopen = async (l) => {
    try {
      await reopenDeal(dealIdOf(l));
      /* Awaited, unlike the `sold`/`rented` mark above, because this one can be refused: the server
         will not return a listing to `approved` while it has no locality, since that is the state
         that reads as live and behaves as missing (register item 24). A listing that was approved
         once already has one, so this is a corner — but an unhandled rejection here would leave the
         deal reopened and the listing silently still closed. */
      await setListingStatus(l.id, 'approved');
    } catch (err) {
      toast(err?.body?.error || err?.message || 'Could not reopen the listing', 'error');
      return;
    }
    toast(`${l.title} reopened for listing`, 'success');
    await refreshDeals(listingKey);
    refreshListings();
  };

  /* Carve a live rent listing into per-room supply. The rooms inherit this
     listing's propertyId, which is what makes them owner-verified; the whole-flat
     listing stays live until somebody actually moves in.

     Through the seam rather than `lib/data/flatSplit.js`, which is what this called before: that
     wrote the rooms to `draazyRoomListings` in the owner's own browser, so a split never left
     the device that performed it and no seeker ever saw the supply it created.

     The badge is now decided by the server from the parent listing's own status, so there is no
     `res.pending` flag to branch on — the rooms come back carrying the verdict. Reading it off the
     response says the same thing the flag did while being answerable by whoever is asking. */
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
    refreshListings();
  };

  /* Undoing a split is one decision about a flat, not a stack of per-room deletes — the per-room
     withdraw answers 409 `split_room` for exactly that reason. The server also refuses once anyone
     has moved in, and that refusal is the product rule this reports rather than a failure to
     handle: those rooms hold a live tenancy. */
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
    refreshListings();
  };

  const handleToggleFeature = async (l) => {    const rec = await toggleFeatured(l.id);
    const nowFeatured = rec.featured;
    toast(nowFeatured ? `${l.title} is now featured` : `${l.title} removed from featured`, nowFeatured ? 'success' : 'info');
    refreshListings();
  };

  // Anti-staleness: owner confirms a listing is still available (or reactivates a paused
  // one), which stamps the confirmation server-side and resets it to Active / makes it
  // visible again. The freshness state is derived from that instant on read, so there is
  // nothing else to update -- refreshing the list is enough.
  const handleConfirmFresh = async (l) => {
    await confirmListingFresh(l.id);
    toast(`"${l.title}" confirmed as available`, 'success');
    refreshListings();
  };

  // Sequential rather than Promise.all, deliberately: this is a burst of writes from one
  // owner, and firing them together is the shape that trips a rate limiter on the one
  // action the platform most wants owners to perform.
  const handleConfirmAll = async () => {
    const stale = listingsState.filter((l) => !l.flatmate && listingFreshness(l).owner.cta);
    for (const l of stale) await confirmListingFresh(l.id);
    toast(`${stale.length} listing${stale.length === 1 ? '' : 's'} confirmed as available`, 'success');
    refreshListings();
  };

  /* `handleWaReminder` stood here. It called `sendWhatsappTemplate(l.id, 'wa-dormant')` — the last
     caller of that function anywhere in the app — and opened a `wa.me` link to a chaser written in
     the platform's voice, signed "— Draazy Team", asking the reader to reply "YES" to reconfirm
     availability. This is the owner's own dashboard and the number was the owner's own, so the
     owner was being handed a message from us, to them, to send to themselves.

     `c3ea034` already fixed half of it: the toast used to fire unconditionally, and against the
     live API it was a lie, because the function composed its URL from the mock store while these
     listings come from the server. Making the toast honest left a button that honestly reported it
     could not do a thing that should not have been offered.

     The one thing the chaser asks for — reconfirm availability — is `onConfirmFresh` →
     `confirmListingFresh`, live since `b230be8`, and it renders as the card's *primary* button on
     exactly the two freshness states that showed this control. Register item 28, option (1).

     The template itself is not deleted and is not wrong: the WhatsApp template block in
     `R__DML_seed_reference_data.sql` has it server-side (it lived in `V78__outbound_messages.sql`
     until the Flyway chain was consolidated), where staff send it from the moderation console and
     it lands in the outbound ledger. `POST /properties/{id}/outreach` 403s for an owner
     deliberately — outreach is the platform speaking to an owner, and an owner is not the platform
     — so there was never a live endpoint to port this onto. */

  // Listings (properties only) that need the owner's attention, for the nudge banner.
  const attentionListings = useMemo(
    () => listingsState.filter((l) => !l.flatmate && listingFreshness(l).owner.cta),
    [listingsState],
  );
  const dormantCount = useMemo(
    () => listingsState.filter((l) => !l.flatmate && listingFreshness(l).state === 'dormant').length,
    [listingsState],
  );

  /* The branches are not interchangeable: a room is withdrawn through its own endpoint, which can
     refuse. A split flat's rooms share one occupancy ledger and one joint agreement, so the server
     answers 409 rather than half-dismantling the arrangement — that refusal has to reach the owner
     as words, not as a toast that says the room was deleted while it is still on the board.

     The property branch was three defects stacked on one line: `setListingStatus(l.id, 'deleted')`.
     It is the *moderator's* route (`PATCH /properties/{id}/status`), so an owner is not authorised
     for it; `deleted` is not one of the three statuses that route accepts, so it is a 400 even for
     staff; and it was not awaited, so both failures were swallowed and the owner was told their
     listing was deleted, after which `refreshListings()` put it straight back on screen.

     That mattered more than a cosmetic bug, because the listing quota is enforced on the server now
     (D235): the free tier is one listing at a time, and this was the only way to let go of one. A
     ceiling whose exit silently does nothing is a ceiling with no exit. `takeListingDown` is
     `DELETE /me/listings/{id}` — owner-scoped, and soft, because the enquiries and deals that point
     at the listing outlive the owner's interest in it. */
  const handleDelete = async (l) => {
    if (!window.confirm(`Take "${l.title}" down? Buyers will stop seeing it.`)) return;

    try {
      if (l.private) await deleteManaged(l.managedId);
      else if (l.flatmateGroup) deleteFlatmateGroup(l.id);
      else if (l.flatmatePost) deleteFlatmatePost(l.id);
      else if (l.flatmate) await deleteRoom(l.id);
      else await takeListingDown(l.uuid || l.id, user);
    } catch (e) {
      toast(e?.message || `Could not take ${l.title} down. Please try again.`, 'error');
      return;
    }

    toast(`${l.title} taken down`, 'info');
    refreshListings();
  };

  /* Publish a private (managed-only) property into the normal pending-review flow.

     The catch is not defensive padding. A managed record is captured loosely — free-text
     furnishing, a price that may still be zero — and the marketplace contract is stricter, so the
     server re-runs the listing's own validation at this boundary and can refuse. Before D32 this
     was a synchronous call with no failure path at all, so a refusal would have shown the success
     toast and then quietly done nothing. */
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
    refreshListings();
  };

  return (
    <>
      <Card className="p-6">
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
        {attentionListings.length > 0 && (
          <AttentionBanner attentionListings={attentionListings} dormantCount={dormantCount} onConfirmAll={handleConfirmAll} />
        )}
        {counts.property > 0 && <VerifyListingsBanner enquiryCount={totalEnquiries} onVerified={refreshListings} />}
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
                  navigate={navigate}
                />
              ) : (
                <ListingCard
                  key={l.id}
                  l={l}
                  dealStatus={dealStatusOf(l)}
                  split={splitOf(l)}
                  review={reviewsByProp?.get(l.id) || null}
                  user={user}
                  leadsFor={leadsFor}
                  featuringOn={featuringOn}
                  canFeature={canFeature}
                  navigate={navigate}
                  openReview={openReview}
                  onConfirmFresh={handleConfirmFresh}
                  onReopen={handleReopen}
                  onMarkUnderOffer={handleMarkUnderOffer}
                  onFinalize={openFinalizeModal}
                  onToggleFeature={handleToggleFeature}
                  onDelete={handleDelete}
                  onSplit={setSplitTarget}
                  onUnsplit={handleUnsplit}
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
    </>
  );
}
