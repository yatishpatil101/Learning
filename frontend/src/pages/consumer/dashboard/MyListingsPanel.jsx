import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import Select from '../../../components/ui/Select.jsx';
import { setListingStatus, toggleFeatured } from '../../../services/propertyService.js';
import { confirmListingFresh, sendWhatsappTemplate } from '../../../lib/mockApi.js';
import { deleteRoom } from '../../../lib/store.js';
import { closeDeal, reopenDeal, reserveDeal, myDeals } from '../../../services/dealService.js';
import { deleteFlatmatePost, deleteFlatmateGroup } from '../../../lib/data/flatmates.js';
import { myContactRequests } from '../../../services/contactService.js';
import { loadOwnerProperties } from '../../../lib/data/ownerProperties.js';
import { publishManagedProp, deleteManagedProp } from '../../../lib/data/managedProperty.js';
import { splitFlat, unsplitFlat } from '../../../lib/data/flatSplit.js';
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

export default function MyListingsPanel({ listings, user, toast, openReview }) {
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
    } catch (err) {
      toast(err?.body?.error || err?.message || 'Could not reopen the listing', 'error');
      return;
    }
    setListingStatus(l.id, 'approved');
    toast(`${l.title} reopened for listing`, 'success');
    await refreshDeals(listingKey);
    refreshListings();
  };

  /* Carve a live rent listing into per-room supply. The rooms inherit this
     listing's propertyId, which is what makes them owner-verified; the whole-flat
     listing stays live until somebody actually moves in. */
  const handleSplitConfirm = ({ maxOccupants, rooms }) => {
    const res = splitFlat(splitTarget, {
      maxOccupants,
      rooms,
      ownerMobile: user?.mobile || '',
      ownerName: user?.name || '',
    });
    if (!res.ok) { toast(res.message || 'Could not list the rooms — please check the details.', 'error'); return; }
    setSplitTarget(null);
    // An unapproved parent listing means the rooms are live but unbadged until Ops
    // confirms the flat — say so, rather than implying they're verified.
    toast(
      res.pending
        ? `${res.count} room${res.count > 1 ? 's' : ''} listed — they'll show as owner-verified once this property is approved.`
        : `${res.count} room${res.count > 1 ? 's' : ''} listed in Flatmates`,
      'success',
    );
    refreshListings();
  };

  const handleUnsplit = (l) => {
    const res = unsplitFlat(l.id);
    if (!res.ok) { toast('Someone has already moved in, so these rooms can\'t be withdrawn.', 'error'); return; }
    toast(`${l.title} is no longer let room by room`, 'info');
    refreshListings();
  };

  const handleToggleFeature = async (l) => {    const rec = await toggleFeatured(l.id);
    const nowFeatured = rec.featured;
    toast(nowFeatured ? `${l.title} is now featured` : `${l.title} removed from featured`, nowFeatured ? 'success' : 'info');
    refreshListings();
  };

  // Anti-staleness: owner confirms a listing is still available (or reactivates a paused
  // one), which stamps freshenedAt=now and resets it to Active / makes it visible again.
  const handleConfirmFresh = async (l) => {
    await confirmListingFresh(l.id);
    toast(`"${l.title}" confirmed as available`, 'success');
    refreshListings();
  };

  const handleConfirmAll = async () => {
    const stale = listingsState.filter((l) => !l.flatmate && listingFreshness(l).owner.cta);
    for (const l of stale) await confirmListingFresh(l.id);
    toast(`${stale.length} listing${stale.length === 1 ? '' : 's'} confirmed as available`, 'success');
    refreshListings();
  };

  // Opens a pre-filled WhatsApp reminder (the platform nudging the owner) for a dormant listing.
  const handleWaReminder = async (l) => {
    const res = await sendWhatsappTemplate(l.id, 'wa-dormant');
    if (res && res.waUrl) window.open(res.waUrl, '_blank');
    toast('WhatsApp reminder opened', 'info');
  };

  // Listings (properties only) that need the owner's attention, for the nudge banner.
  const attentionListings = useMemo(
    () => listingsState.filter((l) => !l.flatmate && listingFreshness(l).owner.cta),
    [listingsState],
  );
  const dormantCount = useMemo(
    () => listingsState.filter((l) => !l.flatmate && listingFreshness(l).state === 'dormant').length,
    [listingsState],
  );

  const handleDelete = (l) => {
    if (!window.confirm(`Delete "${l.title}"? This cannot be undone.`)) return;

    if (l.private) deleteManagedProp(l.managedId);
    else if (l.flatmateGroup) deleteFlatmateGroup(l.id);
    else if (l.flatmatePost) deleteFlatmatePost(l.id);
    else if (l.flatmate) deleteRoom(l.id);
    else setListingStatus(l.id, 'deleted');

    toast(`${l.title} deleted`, 'info');
    refreshListings();
  };

  // Publish a private (managed-only) property into the normal pending-review flow.
  const handlePublish = (l) => {
    const res = publishManagedProp(l.managedId);
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
                  onWaReminder={handleWaReminder}
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
