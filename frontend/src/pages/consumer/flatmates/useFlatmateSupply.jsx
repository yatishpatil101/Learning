import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useFormDraft, useFieldErrors } from '../../../lib/hooks.js';
import { useVerification } from '../../../context/VerificationContext.jsx';
import { digits } from '../../../lib/contact.js';
import { isSeekerVerified, setSeekerVerified, evaluateHostEligibility, enqueueFlatmateReview, pushNotification, recordAskLocally, rememberAsk } from '../../../lib/data/flatmates.js';
import * as flatmateService from '../../../services/flatmateService.js';
import { initials, seatsLeft, hasAgreementEvidence, inr, perHead, FLATMATE_GROUP_IMG, deriveLocality, replacementTitle } from './helpers.js';

// Supply: posting / group / room / verify / aadhaar / consent state and handlers.
// Shared data mutations go through `refresh` (reloads requests+rooms+groups from
// the store) so this hook never owns the source-of-truth collections.
export function useFlatmateSupply({ refresh, setRooms, user, toast, t, nav: navigate, setInterests, ownsGroup, ownsRoom, myPost }) {
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
  // The opt-in Aadhaar badge, held once in VerificationContext (see below for why it also
  // gates the Flatmates Verified filter and verified-only contact).
  const { verified: aadhaarVerified } = useVerification();
  /* The Flatmates "Verified" badge is the SAME government-backed KYC the rest of
     the app uses (DigiLocker, ADR-009a) — not a second, weaker scheme.

     It used to be granted after an OTP to the number the user was already signed
     in with, which proved nothing new and yet drove the Verified filter, the
     card pills and verified-only contact. Flatmates is where strangers agree to
     share a home, so the badge has to mean at least as much here as it does on a
     property listing. isSeekerVerified is still read so anyone who earned the old
     badge keeps it. */
  const isVerified = user ? (aadhaarVerified || isSeekerVerified(userKey)) : false;


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
  const submitPost = async (e) => {
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
    // The id and timestamp are the server's to assign — the old client-side `'s' + Date.now()`
    // would collide with a real id and, worse, let two devices mint the same one within a
    // millisecond. On failure the modal stays open with what the user typed still in it.
    try {
      if (editingId && myPost && myPost.id === editingId) {
        await flatmateService.updatePost(editingId, data);
      } else {
        await flatmateService.createPost(data);
      }
    } catch (err) {
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    await refresh();
    postDraft.clear();
    setPostOpen(false);
    setEditingId(null);
    setPost({ name: '', gender: 'female', age: '', occupation: '', budget: '', moveIn: 'now', flatPref: 'any', roomPref: 'any', localities: [], tags: [], note: '', verifiedContactOnly: false });
    toast(editingId ? t('flatmates.requestUpdated') : t('flatmates.requestLive'));
  };
  const deleteMyRequest = async () => {
    if (!myPost) return;
    try {
      await flatmateService.deletePost(myPost.id);
    } catch (err) {
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    await refresh();
    toast(t('flatmates.requestRemoved'));
  };
  const markFilled = async () => {
    if (!myPost) return;
    try {
      await flatmateService.deletePost(myPost.id);
    } catch (err) {
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    await refresh();
    toast(t('flatmates.markedFilled'));
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
  const submitGroup = async (e) => {
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
    const group = { title: grp.title.trim(), locality: grp.locality, policy: grp.policy, rent: +grp.rent, seatsTotal: seats, seatsOpen, members: [{ name: grp.name.trim(), initials: initials(grp.name), verified: isVerified }], tags: grp.tags, note: grp.note, time: 'Just now', ownerMobile: user ? (user.mobile || '') : '', ownerName: grp.name.trim(), hostRole: role, verificationTier, propertyId, agreementDeclared, agreementDoc, ownerConsentMobile: role === 'tenant' ? (grp.consentMobile || '') : '', ownerConsent, addressFingerprint: guard.fingerprint, flagForReview: guard.flagForReview };
    // The saved record carries the server-assigned id, which the review queue below keys on — the
    // locally minted `'mg' + Date.now()` would enqueue a review against a group that does not exist.
    let saved;
    try {
      saved = await flatmateService.createGroup(group);
    } catch (err) {
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    // Tenant declarations are self-attested, and contested addresses are fuzzy —
    // both go to Ops to verify. Owner-tier (linked to a verified property) skips
    // the queue since the property was already vetted.
    if (verificationTier === 'tenant' || guard.flagForReview) {
      enqueueFlatmateReview({
        groupId: saved.id,
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
    await refresh();
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
  /* Seat and occupancy steppers are +1/-1 controls, so they are tapped in bursts. Making their
     handlers async opened a gap that did not exist when the write was a synchronous localStorage
     call: the second tap reads the row captured by a render that has not happened yet, both
     requests ask for the same number, and one tap is silently swallowed (2 → 1, not 2 → 1 → 0).
     These hold the value each row is being moved TO while its request is in flight, so the next tap
     continues from where the row is going rather than from where the screen still says it is. */
  const pendingGroupSeats = useRef({});
  const pendingSeats = useRef({});
  const pendingPeople = useRef({});

  // Backfill lifecycle: the owner reopens a seat when a flatmate leaves, or marks a
  // seat filled when they find a replacement — adjusting only seatsOpen. The group
  // keeps its verificationTier, so a re-list needs no re-verification.
  const setGroupSeats = async (g, delta) => {
    if (!ownsGroup(g)) return;
    const cur = pendingGroupSeats.current[g.id] ?? seatsLeft(g);
    const next = Math.max(0, Math.min(g.seatsTotal, cur + delta));
    if (next === cur) return;
    pendingGroupSeats.current[g.id] = next;
    try {
      await flatmateService.setGroupSeats(g.id, next);
    } catch (err) {
      delete pendingGroupSeats.current[g.id];
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    if (pendingGroupSeats.current[g.id] === next) delete pendingGroupSeats.current[g.id];
    await refresh();
    toast(delta > 0
      ? t('flatmates.groupSeatReopened')
      : (next === 0 ? t('flatmates.groupAllFilled') : t('flatmates.seatMarkedFilled')));
  };
  // Room backfill: the room owner reopens/closes a seat as flatmates come and go,
  // adjusting only seatsOpen (tier stays, so no re-verification). Only tier-aware
  // rooms carry seatsOpen; seed/legacy rooms have no stepper.
  const setRoomSeats = async (r, delta) => {
    if (!ownsRoom(r) || r.seatsOpen == null) return;
    const cur = pendingSeats.current[r.id] ?? seatsLeft(r);
    const next = Math.max(0, Math.min(r.seatsTotal, cur + delta));
    if (next === cur) return;
    pendingSeats.current[r.id] = next;
    // Patch the row from the server's answer rather than from `next`: the seat count is clamped
    // server-side against the flat's cap, so echoing the optimistic value would show the owner a
    // number the flat does not actually have.
    let saved;
    try {
      saved = await flatmateService.setRoomSeats(r.id, next);
    } catch (err) {
      delete pendingSeats.current[r.id];
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    const applied = saved?.seatsOpen ?? next;
    if (pendingSeats.current[r.id] === next) delete pendingSeats.current[r.id];
    setRooms((prev) => prev.map((x) => (x.id === r.id ? { ...x, seatsOpen: applied } : x)));
    toast(delta > 0
      ? t('flatmates.roomSeatReopened')
      : (applied === 0 ? t('flatmates.roomAllFilled') : t('flatmates.seatMarkedFilled')));
  };
  /* Owner-split rooms are priced per room and their occupancy is decided by
     tenants, so the owner records how many people ACTUALLY live in each room
     rather than declaring seats up front. The ledger is clamped in
     setRoomOccupants against the flat's cap, so a society limit can't be
     exceeded by editing one room. */
  const setRoomPeople = async (r, delta) => {
    if (!ownsRoom(r)) return;
    const cur = pendingPeople.current[r.id] ?? (Number(r.occupants) || 0);
    const want = cur + delta;
    if (want < 0) return;
    pendingPeople.current[r.id] = want;
    let saved;
    try {
      saved = await flatmateService.setRoomOccupants(r.id, want);
    } catch (err) {
      delete pendingPeople.current[r.id];
      // The clamp is a rule, not a fault: "this flat is full" is the useful message, and the
      // server's own text says which cap was hit.
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    const applied = Number(saved?.occupants ?? cur);
    if (pendingPeople.current[r.id] === want) delete pendingPeople.current[r.id];
    if (applied === (Number(r.occupants) || 0)) return;
    setRooms((prev) => prev.map((x) => (x.id === r.id ? { ...x, occupants: applied } : x)));
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
  const deleteGroup = async (g) => {
    if (!ownsGroup(g)) return;
    try {
      await flatmateService.deleteGroup(g.id);
    } catch (err) {
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    await refresh();
    toast(t('flatmates.groupRemoved'));
  };
  /* Joining a group. Goes through the seam (D181).

     The client-side "is it full?" pre-check is gone on purpose. It read the list the board was
     rendering, which is a snapshot — the seat this person is reaching for may have gone a minute
     ago, and the card would still offer the button. Only the provider knows, and it answers
     `group_full`: a DIFFERENT 409 from `already_interested`, on the same door, needing the opposite
     tone. `already_interested` is informational (the host has the ask); `group_full` is a refusal.
     Neither is `common.somethingWentWrong`.

     The card still hides the button on a group it knows to be full — that is a legitimate render
     gate on the data it has, and it makes `group_full` the race it actually is. */
  const onJoin = async (g) => {
    if (!user) { navigate('/signin?next=' + encodeURIComponent(window.location.pathname)); return; }
    if (ownsGroup(g)) { toast(t('flatmates.alreadyMember')); return; }
    const key = 'group-' + g.id;
    const open = g.policy === 'any';
    const opener = open
      ? "Hi! I'd love to join your flatmate group. When can I move in?"
      : "Hi! I'd like to request a spot in your flatmate group — is it still open?";
    /* One record for both answers (D183). The device that receives the duplicate `409` is often not
       the one that made the original request, and it has to end up holding the same bell entry and
       Messages thread — otherwise the card reads "requested" next to an empty inbox. */
    const ask = {
      notification: { type: 'share', title: open ? 'You joined ' + g.title : 'Join request sent', desc: (user.name || 'A seeker') + (open ? ' joined the flatmate group ' : ' asked to join the flatmate group ') + g.title + '.', link: '/messages' },
      request: { propertyId: key, property: { title: g.title, price: inr(perHead(g)) + '/mo', loc: (g.locality || 'Pune') + ', Pune', img: FLATMATE_GROUP_IMG }, party: { name: g.title, avatar: (g.title || 'GR').slice(0, 2).toUpperCase() }, firstMessage: opener },
    };
    // Optimistic, and it doubles as the re-entrancy guard: the card re-renders into its joined
    // state before the request settles, so a second tap has no button to land on.
    setInterests((m) => ({ ...m, [key]: true }));
    try {
      await flatmateService.joinGroup(g.id, { share: 'solo', message: opener });
    } catch (err) {
      if (err?.code === flatmateService.CONFLICT_ALREADY_INTERESTED) {
        rememberAsk(user.mobile, key);
        /* Names only what the host holds, never a thread to open — the toast is unchanged. What is
           new is that the thread is now actually here: the Messages entry used to be written on the
           success path only, into this browser's localStorage, so the device that received this 409
           had nothing to show behind its joined card. The call is idempotent on `propertyId`, so
           the device that already holds the request writes nothing. Same reasoning as the seeker
           branch in useFlatmates.jsx; the wording still waits on a server inbox (D183). */
        recordAskLocally(ask);
        toast(t('flatmates.joinRequestAlreadyRecorded', { title: g.title }));
        return;
      }
      setInterests((m) => { const n = { ...m }; delete n[key]; return n; });
      if (err?.code === flatmateService.CONFLICT_GROUP_FULL) {
        // This 409 is the only authoritative word that the board's snapshot is stale — it is the
        // reason the client-side seat pre-check was removed. Rolling back alone would re-render the
        // card as "1 seat left" with a live Join button, so the user's only move is to tap again and
        // be refused again, forever. Refresh first, so the card comes back as Full.
        await refresh();
        toast(t('flatmates.groupAlreadyFull', { title: g.title }), 'error');
        return;
      }
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    rememberAsk(user.mobile, key);
    await refresh();

    recordAskLocally(ask);

    toast(open ? t('flatmates.joinedToast', { title: g.title }) : t('flatmates.requestJoinToast', { title: g.title }));
  };

  const openVerify = () => {
    if (!user) { navigate('/signin?next=' + encodeURIComponent(window.location.pathname)); return; }
    setVerifyOpen(true);
  };
  /* DigiLocker has confirmed identity and already persisted the badge; all that's
     left is to mirror it onto this seeker's live request so their card shows the
     pill without waiting for a re-post. */
  const onVerified = async () => {
    setSeekerVerified(userKey);
    if (myPost) {
      // Best-effort: identity is already verified and persisted, so a failure here costs the badge
      // on one card until the next post edit — not the verification. Swallowing it keeps the
      // success toast honest rather than telling the user verification failed when it did not.
      try {
        await flatmateService.updatePost(myPost.id, { verified: true });
        await refresh();
      } catch (err) { console.warn('[flatmates] badge mirror failed', err); }
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
