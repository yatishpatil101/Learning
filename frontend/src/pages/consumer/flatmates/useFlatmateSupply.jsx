import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useFormDraft, useFieldErrors } from '../../../lib/hooks.js';
import { updateRoom, isAadhaarVerified } from '../../../lib/store.js';
import { setRoomOccupants } from '../../../lib/data/flatSplit.js';
import { digits } from '../../../lib/contact.js';
import { saveFlatmatePost, updateFlatmatePost, deleteFlatmatePost, saveFlatmateGroup, updateFlatmateGroup, deleteFlatmateGroup, isSeekerVerified, setSeekerVerified, hasInterest as hasInterestDB, addInterest as addInterestDB, evaluateHostEligibility, enqueueFlatmateReview, addFlatmateRequest, pushNotification, pushPendingRequest } from '../../../lib/data/flatmates.js';
import { initials, seatsLeft, hasAgreementEvidence, inr, perHead, FLATMATE_GROUP_IMG, deriveLocality, replacementTitle } from './helpers.js';

// Supply: posting / group / room / verify / aadhaar / consent state and handlers.
// Shared data mutations go through `refresh` (reloads requests+rooms+groups from
// the store) so this hook never owns the source-of-truth collections.
export function useFlatmateSupply({ refresh, setRooms, user, toast, t, nav: navigate, interests, setInterests, ownsGroup, ownsRoom, myPost }) {
  const [params] = useSearchParams();
  const [postOpen, setPostOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [post, setPost] = useState({ name: '', gender: 'female', age: '', occupation: '', budget: '', moveIn: 'now', flatPref: 'any', roomPref: 'any', localities: [], tags: [], note: '', verifiedContactOnly: false });
  const [grp, setGrp] = useState({ title: '', locality: 'Baner', policy: 'women', rent: '', seats: '2', seatsOpen: '1', name: '', note: '', tags: [], role: 'tenant', propertyId: '', agreement: false, agreementDoc: null, consentMobile: '', consentVerified: false });
  const postDraft = useFormDraft('pnDraft:flatmate-post', post, setPost, { ignore: ['gender', 'moveIn', 'flatPref', 'roomPref', 'verifiedContactOnly'] });
  // role/propertyId/agreement are ephemeral eligibility signals — intentionally
  // NOT draft-persisted, so a stale badge claim can't be silently restored later.
  const grpDraft = useFormDraft('pnDraft:share-group', grp, setGrp, { ignore: ['locality', 'policy', 'seats', 'seatsOpen', 'role', 'propertyId', 'agreement', 'agreementDoc', 'consentMobile', 'consentVerified'] });
  const postFormRef = useRef(null);
  const grpFormRef = useRef(null);
  const postErr = useFieldErrors(postFormRef);
  const grpErr = useFieldErrors(grpFormRef);

  const userKey = user ? (user.mobile || user.name || 'anon') : 'anon';
  /* The Flatmates "Verified" badge is the SAME government-backed KYC the rest of
     the app uses (DigiLocker, ADR-009a) — not a second, weaker scheme.

     It used to be granted after an OTP to the number the user was already signed
     in with, which proved nothing new and yet drove the Verified filter, the
     card pills and verified-only contact. Flatmates is where strangers agree to
     share a home, so the badge has to mean at least as much here as it does on a
     property listing. isSeekerVerified is still read so anyone who earned the old
     badge keeps it. */
  const isVerified = user ? (isAadhaarVerified() || isSeekerVerified(userKey)) : false;


  // Supply-side floor (badge-not-gate, ADR-019): listing a room, creating a group
  // or posting a request only needs an L1 mobile-verified sign-in — the same floor
  // as the main List Property flow. Identity verification is an opt-in badge, never
  // a wall to reach genuine owners/tenants. Unsigned users are sent to sign-in.
  const requireSignedIn = (action) => {
    if (!user) { navigate('/signin?next=' + encodeURIComponent(window.location.pathname + window.location.search)); return; }
    action();
  };
  const listRoom = () => requireSignedIn(() => navigate('/list-property?flatmate=1'));
  const createGroup = () => requireSignedIn(() => setGroupOpen(true));
  const openPostModal = (id = null) => {
    requireSignedIn(() => {
      // One live request per person: if someone starts a fresh post while they
      // already have one, take them to edit the existing request instead of
      // silently creating a duplicate.
      if (!id && myPost) {
        toast(t('flatmates.alreadyLiveRequest'));
        id = myPost.id;
      }
      setEditingId(id);
      if (id && myPost && myPost.id === id) {
        setPost({
          name: myPost.name || '',
          gender: myPost.gender || 'female',
          age: myPost.age || '',
          occupation: myPost.occupation || '',
          budget: myPost.budget || '',
          moveIn: myPost.moveIn || 'now',
          flatPref: myPost.flatPref || 'any',
          roomPref: myPost.roomPref || 'any',
          localities: myPost.localities || [],
          tags: myPost.tags || [],
          note: myPost.note || '',
          verifiedContactOnly: myPost.verifiedContactOnly || false,
        });
      } else if (!id) {
        setPost({ name: user.name || '', gender: 'female', age: '', occupation: '', budget: '', moveIn: 'now', flatPref: 'any', roomPref: 'any', localities: [], tags: [], note: '', verifiedContactOnly: false });
      }
      setPostOpen(true);
    });
  };
  // Deep-link from the home "Post your requirement" CTA: ?post=1 opens the
  // post-your-requirement form directly (guests are routed to sign-in first).
  useEffect(() => {
    if (params.get('post')) openPostModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const submitPost = (e) => {
    e.preventDefault();
    const ok = postErr.check([
      { name: 'name', ok: !!post.name.trim(), msg: t('flatmates.valAddName') },
      { name: 'budget', ok: !!post.budget, msg: t('flatmates.valAddBudget') },
      { name: 'localities', ok: post.localities.length > 0, msg: t('flatmates.valPickLocality') },
    ], toast);
    if (!ok) return;
    const data = {
      name: post.name.trim(),
      gender: post.gender,
      age: +post.age || undefined,
      occupation: post.occupation,
      budget: +post.budget,
      localities: post.localities,
      moveIn: post.moveIn,
      flatPref: post.flatPref,
      roomPref: post.roomPref,
      tags: post.tags,
      note: post.note,
      verifiedContactOnly: post.verifiedContactOnly,
      mobile: user ? (user.mobile || '') : '',
      verified: isVerified,
      time: 'Just now',
    };
    if (editingId && myPost && myPost.id === editingId) {
      updateFlatmatePost(editingId, data);
    } else {
      data.id = 's' + Date.now();
      data.createdAt = Date.now();
      saveFlatmatePost(data);
    }
    refresh();
    postDraft.clear();
    setPostOpen(false);
    setEditingId(null);
    setPost({ name: '', gender: 'female', age: '', occupation: '', budget: '', moveIn: 'now', flatPref: 'any', roomPref: 'any', localities: [], tags: [], note: '', verifiedContactOnly: false });
    toast(editingId ? t('flatmates.requestUpdated') : t('flatmates.requestLive'));
  };
  const deleteMyRequest = () => {
    if (myPost) {
      deleteFlatmatePost(myPost.id);
      refresh();
      toast(t('flatmates.requestRemoved'));
    }
  };
  const markFilled = () => {
    if (myPost) {
      deleteFlatmatePost(myPost.id);
      refresh();
      toast(t('flatmates.markedFilled'));
    }
  };
  // One-tap prefill when an existing customer attaches a property they already
  // have on PuneNest. We fill only the descriptive fields (title/locality/rent) —
  // never the trust signals — so the honest role/agreement/consent flow is unchanged.
  // The group locality select only offers LOCALITIES, so an unknown locality is left
  // at the current value rather than guessed. Rent is copied only from a rent listing
  // (a sale price is not a monthly rent).
  const prefillGroupFromListing = (listing) => {
    if (!listing) return;
    const loc = deriveLocality(listing.locality, listing.title, listing.loc);
    const rent = listing.deal === 'rent' && listing.price ? String(listing.price) : '';
    setGrp((g) => ({
      ...g,
      propertyId: listing.id,
      title: g.title || replacementTitle({ bhk: listing.bhk, locality: loc || listing.locality }),
      ...(loc ? { locality: loc } : {}),
      ...(rent && !g.rent ? { rent } : {}),
    }));
    grpErr.clear('title'); if (rent) grpErr.clear('rent');
  };
  // Tenant track: prefill from a finalised PuneNest tenancy. We know the flat's rent,
  // locality and the owner's mobile — so we also seed the owner-consent field, making
  // the consent-OTP trust step one tap. Consent still requires the owner's OTP; we
  // only pre-fill the number, never mark it verified. Existing user input is kept.
  const prefillGroupFromTenancy = (t) => {
    if (!t) return;
    const loc = deriveLocality(t.title, t.address);
    setGrp((g) => ({
      ...g,
      role: 'tenant',
      title: g.title || replacementTitle({ locality: loc }),
      ...(loc ? { locality: loc } : {}),
      ...(t.rent && !g.rent ? { rent: String(t.rent) } : {}),
      consentMobile: g.consentMobile || digits(t.ownerMobile).slice(-10),
      consentVerified: false,
    }));
    grpErr.clear('title'); if (t.rent) grpErr.clear('rent');
  };
  const submitGroup = (e) => {
    e.preventDefault();
    const ok = grpErr.check([
      { name: 'title', ok: !!grp.title.trim(), msg: t('flatmates.valAddGroupTitle') },
      { name: 'rent', ok: !!grp.rent, msg: t('flatmates.valAddRent') },
      { name: 'name', ok: !!grp.name.trim(), msg: t('flatmates.valAddName') },
    ], toast);
    if (!ok) return;
    const seats = parseInt(grp.seats, 10) || 2;
    // Seats actually open right now — honest for a tenant backfilling one seat in an
    // already-occupied flat. Clamped to [1, seats] at creation; the owner can later
    // reopen/close seats without re-verifying the group.
    const seatsOpen = Math.max(1, Math.min(seats, parseInt(grp.seatsOpen, 10) || 1));
    // Derive the host eligibility tier from the declared role + proof signal.
    // Sign-in (L1) is the floor; the Verified badge is an optional trust signal.
    const role = grp.role === 'owner' ? 'owner' : 'tenant';
    const propertyId = role === 'owner' ? (grp.propertyId || '') : '';
    // A tenant only claims the Tenant tier if they both declare AND attach the
    // agreement — the artifact Ops verifies. Declared-without-upload stays identity
    // tier (still posts, just no host badge and no review queue).
    const agreementDoc = role === 'tenant' && grp.agreement ? (grp.agreementDoc || null) : null;
    const agreementDeclared = role === 'tenant' ? (!!grp.agreement && hasAgreementEvidence(agreementDoc)) : false;
    const verificationTier = role === 'owner'
      ? (propertyId ? 'owner' : 'identity')
      : (agreementDeclared ? 'tenant' : 'identity');
    // Anti-broker guardrails: cap live shares per identity + address dedupe. A
    // hard block (cap hit / same host re-claiming an address) stops the save; a
    // soft flag (a different host already claimed this address) still posts but
    // is routed to the Ops review queue.
    const guard = evaluateHostEligibility({
      mobile: user ? user.mobile : '',
      tier: verificationTier,
      address: { propertyId, locality: grp.locality, title: grp.title.trim() },
    });
    if (guard.blocked) { toast(guard.reason, 'error'); return; }
    const ownerConsent = role === 'tenant' ? !!grp.consentVerified : false;
    const group = { id: 'mg' + Date.now(), title: grp.title.trim(), locality: grp.locality, policy: grp.policy, rent: +grp.rent, seatsTotal: seats, seatsOpen, members: [{ name: grp.name.trim(), initials: initials(grp.name), verified: isVerified }], tags: grp.tags, note: grp.note, time: 'Just now', createdAt: Date.now(), ownerMobile: user ? (user.mobile || '') : '', ownerName: grp.name.trim(), hostRole: role, verificationTier, propertyId, agreementDeclared, ownerConsentMobile: role === 'tenant' ? (grp.consentMobile || '') : '', ownerConsent, addressFingerprint: guard.fingerprint, flagForReview: guard.flagForReview };
    saveFlatmateGroup(group);
    // Tenant declarations are self-attested, and contested addresses are fuzzy —
    // both go to Ops to verify. Owner-tier (linked to a verified property) skips
    // the queue since the property was already vetted.
    if (verificationTier === 'tenant' || guard.flagForReview) {
      enqueueFlatmateReview({
        groupId: group.id,
        kind: 'group',
        host: group.ownerName,
        hostMobile: digits(group.ownerMobile),
        address: (group.title || '') + ' · ' + (group.locality || 'Pune'),
        tier: verificationTier,
        flagForReview: guard.flagForReview,
        ownerConsent,
        agreementDoc,
      });
    }
    if (ownerConsent) {
      pushNotification({ type: 'share', title: 'Owner consent recorded', desc: `The owner confirmed your replacement search for "${group.title}".`, link: '/flatmates?view=team-up' });
    }
    refresh();
    grpDraft.clear();
    setGroupOpen(false); setGrp({ title: '', locality: 'Baner', policy: 'women', rent: '', seats: '2', seatsOpen: '1', name: '', note: '', tags: [], role: 'tenant', propertyId: '', agreement: false, agreementDoc: null, consentMobile: '', consentVerified: false });
    toast(t('flatmates.groupLive'));
  };
  // Owner-consent OTP ping: a tenant enters the flat owner's mobile, then confirms
  // via an OTP sent to the owner. Requires a valid 10-digit number before opening.
  const openConsent = () => {
    const m = digits(grp.consentMobile);
    if (m.length !== 10) { toast(t('flatmates.enterOwnerMobile'), 'error'); return; }
    setConsentOpen(true);
  };
  // Backfill lifecycle: the owner reopens a seat when a flatmate leaves, or marks a
  // seat filled when they find a replacement — adjusting only seatsOpen. The group
  // keeps its verificationTier, so a re-list needs no re-verification.
  const setGroupSeats = (g, delta) => {
    if (!ownsGroup(g)) return;
    const cur = seatsLeft(g);
    const next = Math.max(0, Math.min(g.seatsTotal, cur + delta));
    if (next === cur) return;
    updateFlatmateGroup(g.id, { seatsOpen: next });
    refresh();
    toast(delta > 0
      ? t('flatmates.groupSeatReopened')
      : (next === 0 ? t('flatmates.groupAllFilled') : t('flatmates.seatMarkedFilled')));
  };
  // Room backfill: the room owner reopens/closes a seat as flatmates come and go,
  // adjusting only seatsOpen (tier stays, so no re-verification). Only tier-aware
  // rooms carry seatsOpen; seed/legacy rooms have no stepper.
  const setRoomSeats = (r, delta) => {
    if (!ownsRoom(r) || r.seatsOpen == null) return;
    const cur = seatsLeft(r);
    const next = Math.max(0, Math.min(r.seatsTotal, cur + delta));
    if (next === cur) return;
    updateRoom(r.id, { seatsOpen: next });
    setRooms((prev) => prev.map((x) => (x.id === r.id ? { ...x, seatsOpen: next } : x)));
    toast(delta > 0
      ? t('flatmates.roomSeatReopened')
      : (next === 0 ? t('flatmates.roomAllFilled') : t('flatmates.seatMarkedFilled')));
  };
  /* Owner-split rooms are priced per room and their occupancy is decided by
     tenants, so the owner records how many people ACTUALLY live in each room
     rather than declaring seats up front. The ledger is clamped in
     setRoomOccupants against the flat's cap, so a society limit can't be
     exceeded by editing one room. */
  const setRoomPeople = (r, delta) => {
    if (!ownsRoom(r)) return;
    const cur = Number(r.occupants) || 0;
    const res = setRoomOccupants(r.id, cur + delta);
    if (!res.ok || res.occupants === cur) return;
    setRooms((prev) => prev.map((x) => (x.id === r.id ? { ...x, occupants: res.occupants } : x)));
    // One agreement covers the owner and everyone in the flat, so any change to
    // who lives there is the moment to reissue it.
    toast(delta > 0 ? t('flatmates.roomPersonAdded') : t('flatmates.roomPersonRemoved'));
  };

  /* Joint rent agreement: one document covers the owner and every flatmate in
     the flat. When a room changes hands the old document no longer names the
     people living there, so the owner can start a fresh one for the new group. */
  const reissueAgreement = (r) => {
    if (!ownsRoom(r)) return;
    navigate('/services/rent-agreement?flat=' + encodeURIComponent(r.propertyId || r.id) + '&reissue=1');
  };

  // Owner removes a group they created. Seed groups have no owner and are never
  // deletable, so this only ever touches the persisted user-created set.
  const deleteGroup = (g) => {
    if (!ownsGroup(g)) return;
    deleteFlatmateGroup(g.id);
    refresh();
    toast(t('flatmates.groupRemoved'));
  };
  const onJoin = (g) => {
    if (!user) { navigate('/signin?next=' + encodeURIComponent(window.location.pathname)); return; }
    if (ownsGroup(g)) { toast(t('flatmates.alreadyMember')); return; }
    if (seatsLeft(g) <= 0) { toast(t('flatmates.groupAlreadyFull', { title: g.title }), 'error'); return; }
    const key = 'group-' + g.id;
    if (interests[key] || hasInterestDB(key)) { toast(t('flatmates.alreadyAskedJoin', { title: g.title })); return; }
    const open = g.policy === 'any';
    addInterestDB(key);
    setInterests((m) => ({ ...m, [key]: true }));

    addFlatmateRequest(g.ownerMobile, { kind: 'group', action: open ? 'join' : 'request', targetId: key, targetTitle: g.title, locality: g.locality || '', requesterName: user.name || 'Someone', requesterMobile: user.mobile || '' });

    pushNotification({ type: 'share', title: open ? 'You joined ' + g.title : 'Join request sent', desc: (user.name || 'A seeker') + (open ? ' joined the flatmate group ' : ' asked to join the flatmate group ') + g.title + '.', link: '/messages' });

    pushPendingRequest({ propertyId: key, property: { title: g.title, price: inr(perHead(g)) + '/mo', loc: (g.locality || 'Pune') + ', Pune', img: FLATMATE_GROUP_IMG }, party: { name: g.title, avatar: (g.title || 'GR').slice(0, 2).toUpperCase() }, firstMessage: open ? "Hi! I'd love to join your flatmate group. When can I move in?" : "Hi! I'd like to request a spot in your flatmate group — is it still open?" });

    toast(open ? t('flatmates.joinedToast', { title: g.title }) : t('flatmates.requestJoinToast', { title: g.title }));
  };

  const openVerify = () => {
    if (!user) { navigate('/signin?next=' + encodeURIComponent(window.location.pathname)); return; }
    setVerifyOpen(true);
  };
  /* DigiLocker has confirmed identity and already persisted the badge; all that's
     left is to mirror it onto this seeker's live request so their card shows the
     pill without waiting for a re-post. */
  const onVerified = () => {
    setSeekerVerified(userKey);
    if (myPost) {
      updateFlatmatePost(myPost.id, { verified: true });
      refresh();
    }
    setVerifyOpen(false);
    toast(t('flatmates.nowVerifiedSeeker'));
  };

  return {
    post, setPost, postOpen, setPostOpen, postFormRef, postDraft, postErr, editingId,
    openPostModal, submitPost, deleteMyRequest, markFilled,
    grp, setGrp, groupOpen, setGroupOpen, grpFormRef, grpDraft, grpErr, submitGroup,
    prefillGroupFromListing, prefillGroupFromTenancy,
    openConsent, consentOpen, setConsentOpen,
    setGroupSeats, setRoomSeats, setRoomPeople, reissueAgreement, deleteGroup, onJoin, listRoom, createGroup,
    verifyOpen, setVerifyOpen, openVerify, onVerified, isVerified,
  };
}
