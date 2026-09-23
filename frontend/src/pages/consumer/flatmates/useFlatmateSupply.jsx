import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useFormDraft, useFieldErrors } from '../../../lib/hooks.js';
import { useVerification } from '../../../context/VerificationContext.jsx';
import { digits } from '../../../lib/contact.js';
import { useSignInGate } from '../../../lib/useSignInGate.js';
import { isSeekerVerified, evaluateHostEligibility, recordAskLocally, rememberAsk } from '../../../lib/data/flatmates.js';
import * as flatmateService from '../../../services/flatmateService.js';
import { initials, seatsLeft, hasAgreementEvidence, inr, perHead, numeric, terms, FLATMATE_GROUP_IMG, deriveLocality, replacementTitle } from './helpers.js';

// Blank "share your flat" form. Named because it is both the initial state and the reset after a
// successful post, and the two drifting apart leaves a field populated across submissions.
const BLANK_GROUP = { title: '', locality: 'Baner', policy: 'women', rent: '', deposit: '', noticePeriodDays: '', lockInMonths: '', maintenanceBilling: '', electricityBilling: '', seats: '2', name: '', note: '', tags: [], role: 'tenant', propertyId: '', agreement: false, agreementDoc: null, agreementRegNo: '', agreementRegisteredOn: '', agreementValidTill: '', consentMobile: '', consentVerified: false };

// Marks "this mount already sent the visitor to sign in" in the same ref that latches a handled
// `?post=`. A Symbol rather than a string so it can never collide with a value the URL carries.
const SIGNIN_LATCH = Symbol('sent-to-signin');

// Supply: posting / group / room / verify / aadhaar / consent state and handlers. Shared data
// mutations go through `refresh`, so this hook never owns the source-of-truth collections.
export function useFlatmateSupply({ refresh, setRooms, user, authLoading, toast, t, nav: navigate, setInterests, ownsGroup, ownsRoom, myPost, myPostsStatus }) {
  const [params, setParams] = useSearchParams();
  const sendToSignIn = useSignInGate();
  const [postOpen, setPostOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [post, setPost] = useState({ name: '', gender: 'female', age: '', occupation: '', budget: '', budgetMax: '', moveIn: 'now', flatPref: 'any', roomPref: 'any', localities: [], tags: [], note: '', verifiedContactOnly: false });
  const [grp, setGrp] = useState(BLANK_GROUP);
  const postDraft = useFormDraft('dzDraft:flatmate-post', post, setPost, { ignore: ['gender', 'moveIn', 'flatPref', 'roomPref', 'verifiedContactOnly'] });
  const grpDraft = useFormDraft('dzDraft:share-group:v2', grp, setGrp, { ignore: ['policy', 'seats', 'locality'], omit: ['role', 'propertyId', 'agreement', 'agreementDoc', 'agreementRegNo', 'agreementRegisteredOn', 'agreementValidTill', 'consentMobile', 'consentVerified'] });
  const postFormRef = useRef(null);
  const grpFormRef = useRef(null);
  const postErr = useFieldErrors(postFormRef);
  const grpErr = useFieldErrors(grpFormRef);

  const userKey = user ? (user.mobile || user.name || 'anon') : 'anon';
  // The opt-in identity badge, held once in VerificationContext (see below for why it also
  // gates the Flatmates Verified filter and verified-only contact).
  const { verified: identityVerified } = useVerification();
  /* The same reviewed identity badge the rest of the app uses — flatmates is
     where strangers agree to share a home. `isSeekerVerified` honours the older OTP-granted badge. */
  const isVerified = user ? (identityVerified || isSeekerVerified(userKey)) : false;


  // Posting only needs an L1 mobile-verified sign-in, the same floor as List Property.
  // Identity verification is an opt-in badge, never a wall.
  const requireSignedIn = (action) => {
    if (!user) { sendToSignIn('listproperty'); return; }
    action();
  };
  /* No `listRoom` twin of these: the app-wide sheet navigates to `/list-property?flatmate=1` from
     wherever it was opened, so a board-only copy would be a second door to the same room. */
  const createGroup = () => requireSignedIn(() => setGroupOpen(true));
  const openPostModal = (id = null) => {
    requireSignedIn(() => {
      // One live request per person: a fresh post while one already exists edits the existing
      // request rather than silently creating a duplicate.
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
          budgetMax: myPost.budgetMax || '',
          moveIn: myPost.moveIn || 'now',
          flatPref: myPost.flatPref || 'any',
          roomPref: myPost.roomPref || 'any',
          localities: myPost.localities || [],
          tags: myPost.tags || [],
          note: myPost.note || '',
          verifiedContactOnly: myPost.verifiedContactOnly || false,
        });
      } else if (!id) {
        setPost({ name: user.name || '', gender: 'female', age: '', occupation: '', budget: '', budgetMax: '', moveIn: 'now', flatPref: 'any', roomPref: 'any', localities: [], tags: [], note: '', verifiedContactOnly: false });
      }
      setPostOpen(true);
    });
  };
  /* `?post=` carries a posting intent from the app-wide PostChooser. Consumed on arrival and gated
     on auth and own-posts settling — see `docs/flows/consumer/flatmates.md` § One posting entry. */
  const postIntent = params.get('post');
  /* Latched by value and disarmed when the param goes away, so StrictMode replays cannot
     double-toast. A Symbol marks the signed-out redirect — it can never equal a `?post=` value. */
  const handledIntent = useRef(null);
  useEffect(() => {
    if (!postIntent) { handledIntent.current = null; return; }
    if (authLoading) return;
    if (!user) {
      /* This branch is reached again whenever a later dep settles, by which time `navigate` has
         moved the location to `/signin` — a second call would redirect with no `next` at all. */
      if (handledIntent.current !== SIGNIN_LATCH) {
        handledIntent.current = SIGNIN_LATCH;
        sendToSignIn('listproperty', `/flatmates?post=${encodeURIComponent(postIntent)}`);
      }
      return;
    }
    if (myPostsStatus === 'loading') return;
    if (handledIntent.current === postIntent) return;
    handledIntent.current = postIntent;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('post');
      return next;
    }, { replace: true });
    if (postIntent === 'group') createGroup(); else openPostModal();
    // `createGroup`/`openPostModal` are rebuilt every render; their stale-able closures are gated above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postIntent, authLoading, Boolean(user), myPostsStatus]);
  const submitPost = async (e) => {
    e.preventDefault();
    const ok = postErr.check([
      { name: 'name', ok: !!post.name.trim(), msg: t('flatmates.valAddName') },
      { name: 'budget', ok: !!post.budget, msg: t('flatmates.valAddBudget') },
      { name: 'localities', ok: post.localities.length > 0, msg: t('flatmates.valPickLocality') },
      { name: 'budgetMax', ok: !post.budgetMax || +post.budgetMax >= +post.budget, msg: t('flatmates.valBudgetRange') },
    ], toast);
    if (!ok) return;
    const data = {
      name: post.name.trim(),
      gender: post.gender,
      age: +post.age || undefined,
      occupation: post.occupation,
      budget: +post.budget,
      ...numeric('budgetMax', post.budgetMax),
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
    // The id and timestamp are the server's to assign — a client-minted `'s' + Date.now()` collides
    // with a real id. On failure the modal stays open with what the user typed still in it.
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
    setPost({ name: '', gender: 'female', age: '', occupation: '', budget: '', budgetMax: '', moveIn: 'now', flatPref: 'any', roomPref: 'any', localities: [], tags: [], note: '', verifiedContactOnly: false });
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
  // Rent is copied only from a rent listing — a sale price is not a monthly rent. A consent already
  // taken is dropped if the address moves: it was scoped to the flat it named.
  const prefillGroupFromListing = (listing) => {
    if (!listing) return;
    const loc = deriveLocality(listing.locality, listing.title, listing.loc);
    const rent = listing.deal === 'rent' && listing.price ? String(listing.price) : '';
    setGrp((g) => {
      const title = g.title || replacementTitle({ bhk: listing.bhk, locality: loc || listing.locality });
      const locality = loc || g.locality;
      const moved = title !== g.title || locality !== g.locality;
      return {
        ...g,
        propertyId: listing.id,
        title,
        locality,
        ...(rent && !g.rent ? { rent } : {}),
        ...(moved ? { consentVerified: false } : {}),
      };
    });
    grpErr.clear('title'); if (rent) grpErr.clear('rent');
  };
  // Seeds the owner-consent number too, making the consent-OTP step one tap. The number is only
  // pre-filled, never marked verified — the owner's OTP is still required.
  const prefillGroupFromTenancy = (t) => {
    if (!t) return;
    const loc = deriveLocality(t.title, t.address);
    setGrp((g) => ({
      ...g,
      role: 'tenant',
      propertyId: t.propertyId || t.propId || g.propertyId,
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
    const agreementEvidenceAttached = grp.role === 'tenant' && grp.agreement
      && hasAgreementEvidence(grp.agreementDoc);
    const registrationComplete = grp.agreementRegNo.trim()
      && grp.agreementRegisteredOn
      && grp.agreementValidTill
      && grp.agreementRegisteredOn < grp.agreementValidTill;
    const ok = grpErr.check([
      { name: 'title', ok: !!grp.title.trim(), msg: t('flatmates.valAddGroupTitle') },
      { name: 'rent', ok: !!grp.rent, msg: t('flatmates.valAddRent') },
      { name: 'name', ok: !!grp.name.trim(), msg: t('flatmates.valAddName') },
      { name: 'agreementRegistration', ok: !agreementEvidenceAttached || !!registrationComplete, msg: t('flatmates.valAgreementRegistration') },
    ], toast);
    if (!ok) return;
    const seats = parseInt(grp.seats, 10) || 2;
    // Derive the host eligibility tier from the declared role + proof signal.
    // Sign-in (L1) is the floor; the Verified badge is an optional trust signal.
    const role = grp.role === 'owner' ? 'owner' : 'tenant';
    const propertyId = grp.propertyId || '';
    // A tenant claims the Tenant tier only by declaring AND attaching the agreement — the artifact
    // Ops verifies. Declared-without-upload stays identity tier: still posts, no host badge.
    const agreementDoc = role === 'tenant' && grp.agreement ? (grp.agreementDoc || null) : null;
    const agreementDeclared = role === 'tenant' ? (!!grp.agreement && hasAgreementEvidence(agreementDoc)) : false;
    const verificationTier = role === 'owner'
      ? (propertyId ? 'owner' : 'identity')
      : (agreementDeclared ? 'tenant' : 'identity');
    // Anti-broker guardrails: a hard block stops the save; a soft flag still posts but routes to
    // the Ops review queue.
    const guard = evaluateHostEligibility({
      mobile: user ? user.mobile : '',
      tier: verificationTier,
      address: { propertyId, locality: grp.locality, title: grp.title.trim() },
    });
    if (guard.blocked) { toast(guard.reason, 'error'); return; }
    const ownerConsent = role === 'tenant' ? !!grp.consentVerified : false;
    const group = { title: grp.title.trim(), locality: grp.locality, policy: grp.policy, rent: +grp.rent, ...numeric('deposit', grp.deposit), ...terms(grp), seatsTotal: seats, members: [{ name: grp.name.trim(), initials: initials(grp.name), verified: isVerified }], tags: grp.tags, note: grp.note, time: 'Just now', ownerMobile: user ? (user.mobile || '') : '', ownerName: grp.name.trim(), hostRole: role, verificationTier, propertyId, agreementDeclared, agreementDoc, agreementRegNo: agreementDeclared ? grp.agreementRegNo.trim() : '', agreementRegisteredOn: agreementDeclared ? grp.agreementRegisteredOn : '', agreementValidTill: agreementDeclared ? grp.agreementValidTill : '', ownerConsentMobile: role === 'tenant' ? (grp.consentMobile || '') : '', ownerConsent, addressFingerprint: guard.fingerprint, flagForReview: guard.flagForReview };
    // The saved record carries the server-assigned id, which the review queue below keys on — the
    // locally minted `'mg' + Date.now()` would enqueue a review against a group that does not exist.
    try {
      await flatmateService.createGroup(group);
    } catch (err) {
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    await refresh();
    grpDraft.clear();
    setGroupOpen(false); setGrp(BLANK_GROUP);
    toast(t('flatmates.groupLive'));
  };
  // Requires a valid 10-digit number, plus the title and locality the consent row is scoped by:
  // the server names the flat from those two, so without them the owner's SMS vouches for nothing.
  const openConsent = () => {
    const m = digits(grp.consentMobile);
    if (m.length !== 10) { toast(t('flatmates.enterOwnerMobile'), 'error'); return; }
    if (!grp.title.trim() || !grp.locality.trim()) {
      toast(t('flatmates.consentNeedsTitle'), 'error');
      return;
    }
    setConsentOpen(true);
  };
  /* Steppers are tapped in bursts, and an async handler lets the second tap read a row the render
     has not updated yet. These hold the value each row is moving TO while its request is in flight. */
  const pendingGroupSeats = useRef({});
  const pendingSeats = useRef({});
  const pendingPeople = useRef({});

  // Backfill lifecycle: adjusts only seatsOpen. The group keeps its verificationTier, so a re-list
  // needs no re-verification.
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
  // Room backfill adjusts only seatsOpen, so the tier stays and no re-verification is needed. Only
  // tier-aware rooms carry seatsOpen; seed rooms have no stepper.
  const setRoomSeats = async (r, delta) => {
    if (!ownsRoom(r) || r.seatsOpen == null) return;
    const cur = pendingSeats.current[r.id] ?? seatsLeft(r);
    const next = Math.max(0, Math.min(r.seatsTotal, cur + delta));
    if (next === cur) return;
    pendingSeats.current[r.id] = next;
    // Patch from the server's answer, not `next`: the count is clamped server-side against the
    // flat's cap, so echoing the optimistic value shows a number the flat does not have.
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
  /* Owner-split rooms are priced per room and occupancy is decided by tenants, so the owner records
     who ACTUALLY lives in each room rather than declaring seats up front. */
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

  /* One document covers the owner and every flatmate, so when a room changes hands the old one
     stops naming the people living there and the owner starts a fresh one. */
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
  /* No client-side "is it full?" pre-check — only the provider knows. Its `group_full` is a
     refusal, distinct from the informational `already_interested`; neither is a generic error. */
  const onJoin = async (g) => {
    if (!user) { sendToSignIn('community'); return; }
    if (ownsGroup(g)) { toast(t('flatmates.alreadyMember')); return; }
    const key = 'group-' + g.id;
    const open = g.policy === 'any';
    const opener = open
      ? "Hi! I'd love to join your flatmate group. When can I move in?"
      : "Hi! I'd like to request a spot in your flatmate group — is it still open?";
    /* One record for both answers: the device receiving the duplicate `409` is often not the one
       that made the request, and must still hold the same Messages thread. */
    const ask = {
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
        // Idempotent on `propertyId`: the device that already holds the request writes nothing, and
        // the one seeing this 409 still gets a thread behind its joined card.
        recordAskLocally(ask);
        toast(t('flatmates.joinRequestAlreadyRecorded', { title: g.title }));
        return;
      }
      setInterests((m) => { const n = { ...m }; delete n[key]; return n; });
      if (err?.code === flatmateService.CONFLICT_GROUP_FULL) {
        // The only authoritative word that the snapshot is stale. Rolling back alone re-renders a
        // live Join button, leaving the user to tap and be refused forever — so refresh first.
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
    if (!user) { sendToSignIn('verify'); return; }
    setVerifyOpen(true);
  };

  return {
    post, setPost, postOpen, setPostOpen, postFormRef, postDraft, postErr, editingId,
    openPostModal, submitPost, deleteMyRequest, markFilled,
    grp, setGrp, groupOpen, setGroupOpen, grpFormRef, grpDraft, grpErr, submitGroup,
    prefillGroupFromListing, prefillGroupFromTenancy,
    openConsent, consentOpen, setConsentOpen,
    setGroupSeats, setRoomSeats, setRoomPeople, reissueAgreement, deleteGroup, onJoin, createGroup,
    verifyOpen, setVerifyOpen, openVerify, isVerified,
  };
}
