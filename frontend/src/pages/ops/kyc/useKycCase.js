import { useCallback, useEffect, useRef, useState } from 'react';
import { claimIdentityReview, getIdentityReview, releaseIdentityReview } from '../../../services/identityReviewService.js';
import { errorCode, errorMessage, sameId } from './vocabulary.js';

const claimedMessage = (next) => `Being reviewed by ${next?.claimedByName || 'another reviewer'}`;
const isClaimTaken = (error) => errorCode(error) === 'identity_case_claimed';

export default function useKycCase(openId, { canWrite, userId, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState('');
  const [claimNotice, setClaimNotice] = useState('');
  const [claimTick, setClaimTick] = useState(0);
  const openIdRef = useRef(openId);
  const runRef = useRef(0);
  const activeClaimRef = useRef(null);
  const releaseChainsRef = useRef(new Map());
  const onChangedRef = useRef(onChanged);

  useEffect(() => {
    openIdRef.current = openId;
    onChangedRef.current = onChanged;
  });

  const queueRelease = useCallback((id, gen) => {
    const active = activeClaimRef.current;
    if (!active || active.id !== id || active.gen !== gen) return Promise.resolve();
    activeClaimRef.current = null;
    const prior = releaseChainsRef.current.get(id) || Promise.resolve();
    const next = prior.catch(() => {}).then(() => releaseIdentityReview(id).catch(() => {}));
    const tracked = next.finally(() => {
      if (releaseChainsRef.current.get(id) === tracked) releaseChainsRef.current.delete(id);
    });
    releaseChainsRef.current.set(id, tracked);
    return tracked;
  }, []);

  const claimForRun = useCallback(async (id, gen) => {
    const prior = releaseChainsRef.current.get(id);
    if (prior) await prior;
    const claimed = await claimIdentityReview(id);
    activeClaimRef.current = { id, gen };
    return claimed;
  }, []);

  /* A case someone else holds is not claimed on open: the server would refuse it, and the detail
     already names the holder. `claimedByName` is only set while their hold is fresh. */
  const canTryClaim = useCallback(
    (row) => canWrite && row?.status === 'pending' && !sameId(row?.userId, userId) && !row?.claimedByMe && !row?.claimedByName,
    [canWrite, userId],
  );

  const applyDetail = useCallback((next) => {
    setDetail(next);
    setClaimNotice(next?.status === 'pending' && next?.claimedByName && !next?.claimedByMe ? claimedMessage(next) : '');
  }, []);

  /* Shared by open, refresh and decide: claim if allowed, and on a lost race show who holds it. The claim
     answers only who holds the case, so it is laid over the record already read. */
  const claimOrShowHolder = useCallback(async (id, gen, fallback, isCurrent) => {
    try {
      const claimed = await claimForRun(id, gen);
      if (!isCurrent()) {
        queueRelease(id, gen);
        return false;
      }
      applyDetail({ ...fallback, ...claimed });
      return true;
    } catch (nextError) {
      if (!isCurrent()) return false;
      if (!isClaimTaken(nextError)) {
        if (fallback) applyDetail(fallback);
        setError(errorMessage(nextError, 'Could not claim this review.'));
        return false;
      }
      const fresh = await getIdentityReview(id).catch(() => fallback);
      if (!isCurrent()) return false;
      if (fresh) applyDetail(fresh);
      if (fresh?.status === 'pending') setClaimNotice(claimedMessage(fresh));
      return false;
    }
  }, [applyDetail, claimForRun, queueRelease]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      setClaimNotice('');
      setError('');
      return undefined;
    }
    const gen = runRef.current + 1;
    runRef.current = gen;
    let alive = true;
    const isCurrent = () => alive && openIdRef.current === openId && runRef.current === gen;
    setLoading(true);
    setDetail(null);
    setError('');
    setClaimNotice('');

    (async () => {
      try {
        const initial = await getIdentityReview(openId);
        if (!isCurrent()) return;
        if (initial?.status === 'pending' && initial?.claimedByMe) activeClaimRef.current = { id: openId, gen };
        if (canTryClaim(initial)) await claimOrShowHolder(openId, gen, initial, isCurrent);
        else applyDetail(initial);
      } catch (nextError) {
        if (isCurrent()) setError(nextError?.message || 'Could not load this review.');
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      queueRelease(openId, gen);
    };
  }, [openId, claimTick, canTryClaim, applyDetail, claimOrShowHolder, queueRelease]);

  const stillOpen = (id) => () => openIdRef.current === id;

  /* Signed image links are short-lived; this re-reads the case and, if the hold lapsed, re-claims it. */
  async function refresh() {
    const id = openIdRef.current;
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const fresh = await getIdentityReview(id);
      if (!stillOpen(id)()) return;
      if (canTryClaim(fresh) && await claimOrShowHolder(id, runRef.current, fresh, stillOpen(id))) return;
      if (stillOpen(id)() && !canTryClaim(fresh)) applyDetail(fresh);
    } catch (nextError) {
      if (stillOpen(id)()) setError(nextError?.message || 'Could not refresh image links.');
    } finally {
      if (stillOpen(id)()) setLoading(false);
    }
  }

  /* Returns `identity_number_mismatch` instead of showing it, so the approve form can offer the override. */
  async function decide(submit, failureMessage, { requireClaim = false } = {}) {
    if (!detail || deciding) return null;
    const id = detail.id;
    setDeciding(true);
    setError('');
    try {
      if (requireClaim && activeClaimRef.current?.id !== id) {
        if (!await claimOrShowHolder(id, runRef.current, detail, stillOpen(id))) return null;
      }
      const next = await submit();
      if (!stillOpen(id)()) return null;
      if (activeClaimRef.current?.id === id) activeClaimRef.current = null;
      applyDetail(next);
      onChangedRef.current?.();
      return null;
    } catch (nextError) {
      if (!stillOpen(id)()) return null;
      if (errorCode(nextError) === 'identity_number_mismatch') return 'identity_number_mismatch';
      setError(errorMessage(nextError, failureMessage));
      if (nextError?.status === 403 || isClaimTaken(nextError)) {
        onChangedRef.current?.();
        const fresh = await getIdentityReview(id).catch(() => null);
        if (!stillOpen(id)()) return null;
        if (!fresh) setDetail(null);
        else {
          applyDetail(fresh);
          if (isClaimTaken(nextError) && fresh.status === 'pending') setClaimNotice(claimedMessage(fresh));
        }
      }
      return null;
    } finally {
      setDeciding(false);
    }
  }

  async function forceRelease() {
    if (!detail || deciding) return;
    const id = detail.id;
    setDeciding(true);
    setError('');
    try {
      await releaseIdentityReview(id, { force: true });
      if (!stillOpen(id)()) return;
      const fresh = await getIdentityReview(id);
      if (!stillOpen(id)()) return;
      applyDetail(fresh);
      onChangedRef.current?.();
    } catch (nextError) {
      if (stillOpen(id)()) setError(errorMessage(nextError, 'Could not release this claim.'));
    } finally {
      setDeciding(false);
    }
  }

  const claim = () => {
    if (activeClaimRef.current?.id !== openIdRef.current) setClaimTick((t) => t + 1);
  };

  return { detail, loading, deciding, error, claimNotice, refresh, decide, forceRelease, claim };
}
