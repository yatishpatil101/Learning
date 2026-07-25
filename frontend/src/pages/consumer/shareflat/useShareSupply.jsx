import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useFormDraft, useFieldErrors, useMobileInput } from '../../../lib/hooks.js';
import { useOtpFlow } from '../../../components/auth/useOtpFlow.js';
import { updateRoom, isAadhaarVerified } from '../../../lib/store.js';
import { digits } from '../../../lib/contact.js';
import { saveShareRequest, updateShareRequest, deleteShareRequest, saveShareGroup, updateShareGroup, deleteShareGroup, isSeekerVerified, setSeekerVerified, hasInterest as hasInterestDB, addInterest as addInterestDB, evaluateHostEligibility, enqueueShareReview, addShareFlatRequest } from '../../../lib/data/shareFlat.js';
import { initials, seatsLeft, hasAgreementEvidence, inr, perHead, SHARE_GROUP_IMG, deriveLocality, replacementTitle } from './helpers.js';

// Supply: posting / group / room / verify / aadhaar / consent state and handlers.
// Shared data mutations go through `refresh` (reloads requests+rooms+groups from
// the store) so this hook never owns the source-of-truth collections.
export function useShareSupply({ refresh, setRooms, user, toast, t, nav: navigate, interests, setInterests, ownsGroup, ownsRoom, myPost }) {
  const [params] = useSearchParams();
  const [postOpen, setPostOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  // Aadhaar identity gate for supply-side actions (listing a room / creating a
  // group). Unverified users get the shared Aadhaar OTP popup; the intended
  // action is parked in a ref and resumed on successful verification.
  const [aadhaarGateOpen, setAadhaarGateOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const pendingSupplyAction = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [post, setPost] = useState({ name: '', gender: 'female', age: '', occupation: '', budget: '', moveIn: 'now', flatPref: 'any', roomPref: 'any', localities: [], tags: [], note: '', verifiedContactOnly: false });
  const [grp, setGrp] = useState({ title: '', locality: 'Baner', policy: 'women', rent: '', seats: '2', seatsOpen: '1', name: '', note: '', tags: [], role: 'tenant', propertyId: '', agreement: false, agreementDoc: null, consentMobile: '', consentVerified: false });
  const postDraft = useFormDraft('pnDraft:share-post', post, setPost, { ignore: ['gender', 'moveIn', 'flatPref', 'roomPref', 'verifiedContactOnly'] });
  // role/propertyId/agreement are ephemeral eligibility signals — intentionally
  // NOT draft-persisted, so a stale badge claim can't be silently restored later.
  const grpDraft = useFormDraft('pnDraft:share-group', grp, setGrp, { ignore: ['locality', 'policy', 'seats', 'seatsOpen', 'role', 'propertyId', 'agreement', 'agreementDoc', 'consentMobile', 'consentVerified'] });
  const postFormRef = useRef(null);
  const grpFormRef = useRef(null);
  const postErr = useFieldErrors(postFormRef);
  const grpErr = useFieldErrors(grpFormRef);

  const userKey = user ? (user.mobile || user.name || 'anon') : 'anon';
  const isVerified = user ? isSeekerVerified(userKey) : false;

  const mobile = useMobileInput(user ? (user.mobile || '') : '');
  const [mobileErr, setMobileErr] = useState(false);
  const otp = useOtpFlow();
  const verifyFormRef = useRef(null);
  const [verifying, setVerifying] = useState(false);

  // Supply-side eligibility gate. Listing a room or creating a group are
  // owner/host actions, so they require a verified identity — not just a login.
  // Order: sign in → Aadhaar OTP verified → run the action. Unverified users see
  // the shared Aadhaar popup and the action resumes once they pass.
  const requireAadhaar = (action) => {
    if (!user) { navigate('/signin?next=' + encodeURIComponent(window.location.pathname + window.location.search)); return; }
    if (!isAadhaarVerified()) { pendingSupplyAction.current = action; setAadhaarGateOpen(true); return; }
    action();
  };
  const listRoom = () => requireAadhaar(() => navigate('/list-property?share=1'));
  const createGroup = () => requireAadhaar(() => setGroupOpen(true));
  const openPostModal = (id = null) => {
    requireAadhaar(() => {
      // One live request per person: if someone starts a fresh post while they
      // already have one, take them to edit the existing request instead of
      // silently creating a duplicate.
      if (!id && myPost) {
        toast(t('shareFlat.alreadyLiveRequest'));
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
      { name: 'name', ok: !!post.name.trim(), msg: t('shareFlat.valAddName') },
      { name: 'budget', ok: !!post.budget, msg: t('shareFlat.valAddBudget') },
      { name: 'localities', ok: post.localities.length > 0, msg: t('shareFlat.valPickLocality') },
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
      updateShareRequest(editingId, data);
    } else {
      data.id = 's' + Date.now();
      data.createdAt = Date.now();
      saveShareRequest(data);
    }
    refresh();
    postDraft.clear();
    setPostOpen(false);
    setEditingId(null);
    setPost({ name: '', gender: 'female', age: '', occupation: '', budget: '', moveIn: 'now', flatPref: 'any', roomPref: 'any', localities: [], tags: [], note: '', verifiedContactOnly: false });
    toast(editingId ? t('shareFlat.requestUpdated') : t('shareFlat.requestLive'));
  };
  const deleteMyRequest = () => {
    if (myPost) {
      deleteShareRequest(myPost.id);
      refresh();
      toast(t('shareFlat.requestRemoved'));
    }
  };
  const markFilled = () => {
    if (myPost) {
      deleteShareRequest(myPost.id);
      refresh();
      toast(t('shareFlat.markedFilled'));
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
      { name: 'title', ok: !!grp.title.trim(), msg: t('shareFlat.valAddGroupTitle') },
      { name: 'rent', ok: !!grp.rent, msg: t('shareFlat.valAddRent') },
      { name: 'name', ok: !!grp.name.trim(), msg: t('shareFlat.valAddName') },
    ], toast);
    if (!ok) return;
    const seats = parseInt(grp.seats, 10) || 2;
    // Seats actually open right now — honest for a tenant backfilling one seat in an
    // already-occupied flat. Clamped to [1, seats] at creation; the owner can later
    // reopen/close seats without re-verifying the group.
    const seatsOpen = Math.max(1, Math.min(seats, parseInt(grp.seatsOpen, 10) || 1));
    // Derive the host eligibility tier from the declared role + proof signal.
    // Aadhaar identity is already guaranteed by the gate, so it's the floor.
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
    saveShareGroup(group);
    // Tenant declarations are self-attested, and contested addresses are fuzzy —
    // both go to Ops to verify. Owner-tier (linked to a verified property) skips
    // the queue since the property was already vetted.
    if (verificationTier === 'tenant' || guard.flagForReview) {
      enqueueShareReview({
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
      try {
        const notifs = JSON.parse(localStorage.getItem('puneNestNotifications') || '[]');
        notifs.unshift({ id: 'n' + Date.now(), type: 'share', title: 'Owner consent recorded', desc: `The owner confirmed your replacement search for "${group.title}".`, time: 'Just now', link: '/share-flat?view=groups', unread: true });
        localStorage.setItem('puneNestNotifications', JSON.stringify(notifs));
      } catch { /* quota */ }
    }
    refresh();
    grpDraft.clear();
    setGroupOpen(false); setGrp({ title: '', locality: 'Baner', policy: 'women', rent: '', seats: '2', seatsOpen: '1', name: '', note: '', tags: [], role: 'tenant', propertyId: '', agreement: false, agreementDoc: null, consentMobile: '', consentVerified: false });
    toast(t('shareFlat.groupLive'));
  };
  // Owner-consent OTP ping: a tenant enters the flat owner's mobile, then confirms
  // via an OTP sent to the owner. Requires a valid 10-digit number before opening.
  const openConsent = () => {
    const m = digits(grp.consentMobile);
    if (m.length !== 10) { toast(t('shareFlat.enterOwnerMobile'), 'error'); return; }
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
    updateShareGroup(g.id, { seatsOpen: next });
    refresh();
    toast(delta > 0
      ? t('shareFlat.groupSeatReopened')
      : (next === 0 ? t('shareFlat.groupAllFilled') : t('shareFlat.seatMarkedFilled')));
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
      ? t('shareFlat.roomSeatReopened')
      : (next === 0 ? t('shareFlat.roomAllFilled') : t('shareFlat.seatMarkedFilled')));
  };
  // Owner removes a group they created. Seed groups have no owner and are never
  // deletable, so this only ever touches the persisted user-created set.
  const deleteGroup = (g) => {
    if (!ownsGroup(g)) return;
    deleteShareGroup(g.id);
    refresh();
    toast(t('shareFlat.groupRemoved'));
  };
  const onJoin = (g) => {
    if (!user) { navigate('/signin?next=' + encodeURIComponent(window.location.pathname)); return; }
    if (ownsGroup(g)) { toast(t('shareFlat.alreadyMember')); return; }
    if (seatsLeft(g) <= 0) { toast(t('shareFlat.groupAlreadyFull', { title: g.title }), 'error'); return; }
    const key = 'group-' + g.id;
    if (interests[key] || hasInterestDB(key)) { toast(t('shareFlat.alreadyAskedJoin', { title: g.title })); return; }
    const open = g.policy === 'any';
    addInterestDB(key);
    setInterests((m) => ({ ...m, [key]: true }));

    addShareFlatRequest(g.ownerMobile, { kind: 'group', action: open ? 'join' : 'request', targetId: key, targetTitle: g.title, locality: g.locality || '', requesterName: user.name || 'Someone', requesterMobile: user.mobile || '' });

    try {
      const notifs = JSON.parse(localStorage.getItem('puneNestNotifications') || '[]');
      notifs.unshift({ id: 'n' + Date.now(), type: 'share', title: open ? 'You joined ' + g.title : 'Join request sent', desc: (user.name || 'A seeker') + (open ? ' joined the flat-share group ' : ' asked to join the flat-share group ') + g.title + '.', time: 'Just now', link: '/messages', unread: true });
      localStorage.setItem('puneNestNotifications', JSON.stringify(notifs));
    } catch { /* quota */ }

    try {
      const pending = JSON.parse(localStorage.getItem('pnPendingRequests') || '[]');
      pending.push({ propertyId: key, property: { title: g.title, price: inr(perHead(g)) + '/mo', loc: (g.locality || 'Pune') + ', Pune', img: SHARE_GROUP_IMG }, party: { name: g.title, avatar: (g.title || 'GR').slice(0, 2).toUpperCase() }, firstMessage: open ? "Hi! I'd love to join your flat-share group. When can I move in?" : "Hi! I'd like to request a spot in your flat-share group — is it still open?" });
      localStorage.setItem('pnPendingRequests', JSON.stringify(pending));
    } catch { /* quota */ }

    toast(open ? t('shareFlat.joinedToast', { title: g.title }) : t('shareFlat.requestJoinToast', { title: g.title }));
  };

  const openVerify = () => {
    if (!user) { navigate('/signin?next=' + encodeURIComponent(window.location.pathname)); return; }
    mobile.setValue(user.mobile || '');
    setMobileErr(false);
    otp.setOtp('');
    otp.setOtpError(false);
    setVerifyOpen(true);
  };
  const submitVerify = (e) => {
    e.preventDefault();
    if (!otp.otpSent) {
      if (!mobile.valid) { setMobileErr(true); return; }
      setMobileErr(false);
      otp.send();
      return;
    }
    if (otp.otp.length < 6) { otp.setOtpError(true); return; }
    setVerifying(true);
    setTimeout(() => {
      setSeekerVerified(userKey);
      if (myPost) {
        updateShareRequest(myPost.id, { verified: true });
        refresh();
      }
      setVerifying(false);
      setVerifyOpen(false);
      toast(t('shareFlat.nowVerifiedSeeker'));
    }, 1200);
  };

  return {
    post, setPost, postOpen, setPostOpen, postFormRef, postDraft, postErr, editingId,
    openPostModal, submitPost, deleteMyRequest, markFilled,
    grp, setGrp, groupOpen, setGroupOpen, grpFormRef, grpDraft, grpErr, submitGroup,
    prefillGroupFromListing, prefillGroupFromTenancy,
    openConsent, consentOpen, setConsentOpen,
    setGroupSeats, setRoomSeats, deleteGroup, onJoin, listRoom, createGroup,
    aadhaarGateOpen, setAadhaarGateOpen, pendingSupplyAction,
    verifyOpen, setVerifyOpen, openVerify, submitVerify, verifyFormRef,
    mobile, mobileErr, setMobileErr, otp, verifying, isVerified,
  };
}
