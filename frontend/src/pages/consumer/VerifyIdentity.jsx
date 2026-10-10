import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { useAuth } from '../../context/AuthContext.jsx';
import { useVerification } from '../../context/VerificationContext.jsx';
import { trackKyc } from '../../lib/kycTrack.js';
import { capturePreparedImage, readFrameQuality, startCameraStream, stopCameraStream } from '../../lib/identity-verification/capture.js';
import { DEFAULT_IDENTITY_DOCUMENT, getIdentityDocument } from '../../lib/identity-verification/documents.js';
import { loadFaceLandmarker, readSelfieGuidance } from '../../lib/identity-verification/face.js';
import { PROVIDER_LOAD_FAILED, healStaleShell, isDefinitelyOffline } from '../../lib/seamErrors.js';
import { disputeIdentityVerification, getIdentityChallenge } from '../../services/verificationService.js';
import { CaptureScreen, PhoneHandoffScreen, ReviewScreen, StartScreen, VerifyShell } from '../../components/verify-identity/VerifyIdentityScreens.jsx';
import StatusScreen from '../../components/verify-identity/StatusScreen.jsx';
import usePreviewStore from '../../components/verify-identity/usePreviewStore.js';

/* Measured from the last sign of progress, so somebody simply taking their time is never waved through. */
const SELFIE_POSES = ['smile', 'left', 'right'];

const LIVENESS_STALL_MS = 8000;
const STEP_INDEX = { start: 0, capture: 1, review: 2, status: 3 };

const randomSelfiePose = () => SELFIE_POSES[Math.floor(Math.random() * SELFIE_POSES.length)];

  /* `healStaleShell` normally reloads out from under this sentence; it is written for the case where that is refused
     — an offline device, or a tab that already reloaded once and still failed. */
function submitFailureMessage(error, t) {
  const code = String(error?.code || '').toLowerCase();
  if (error?.code === PROVIDER_LOAD_FAILED) {
    return isDefinitelyOffline()
      ? t('verifyIdentity.errors.unreachable')
      : t('verifyIdentity.errors.updated');
  }
  if (!error?.status) return t('verifyIdentity.errors.unreachable');
  if (error.status === 429) {
    return Number.isFinite(error.retryAfterSeconds)
      ? t('verifyIdentity.errors.rateLimitedWithRetry', { seconds: error.retryAfterSeconds })
      : t('verifyIdentity.errors.rateLimited');
  }
  if (error.status >= 500) {
    return t('verifyIdentity.errors.server', { reference: error.traceId ? t('verifyIdentity.errors.reference', { traceId: error.traceId }) : '' });
  }
/* What the badge ACTUALLY does here, taken from the code that implements it rather than from a competitor's
   marketing. */
  const codeKey = {
    identity_already_registered: 'alreadyRegistered',
    identity_dispute_open: 'disputeOpen',
    identity_no_recent_conflict: 'disputeConflict',
    conflict: 'disputeConflict',
    invalid_document_number: 'invalidNumber',
    invalid_number: 'invalidNumber',
    validation_failed: 'invalidNumber',
  }[code];
  if (codeKey) return t(`verifyIdentity.errors.${codeKey}`);
  if (error.status === 400) return t('verifyIdentity.errors.invalidNumber');
  if (error.status === 409) return t('verifyIdentity.errors.disputeConflict');
  return t('verifyIdentity.errors.genericClient');
}

export default function VerifyIdentity() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const verification = useVerification();
  const { user, refreshUser } = useAuth();
  const { captures, setCapture, resetCapture, clearCaptures } = usePreviewStore();
  const [step, setStep] = useState('start');
  const [retrying, setRetrying] = useState(false);
  const [docType, setDocType] = useState(DEFAULT_IDENTITY_DOCUMENT.key);
  const [consented, setConsented] = useState(false);
  const [activeFrame, setActiveFrame] = useState('front');
  const [cameraError, setCameraError] = useState('');
  const [qualityHintKey, setQualityHintKey] = useState('line');
  const [selfieHintKey, setSelfieHintKey] = useState('initial');
  const [selfieNoticeKey, setSelfieNoticeKey] = useState('');
  const [selfieChallenge, setSelfieChallenge] = useState({ pose: 'smile', token: null, expiresAt: null });
  const [selfieStage, setSelfieStage] = useState(0);
  // Two separate reasons the stages may be unenforceable, kept apart because they say different
  // things to the user: the model never loaded, or it loaded and cannot read this face in time.
  const [guidanceOff, setGuidanceOff] = useState(false);
  const [stagesBypassed, setStagesBypassed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');
  const [duplicateConflict, setDuplicateConflict] = useState(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeNote, setDisputeNote] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeError, setDisputeError] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [liveResult, setLiveResult] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const videoRef = useRef(null);
  const guideRef = useRef(null);
  const streamRef = useRef(null);
  const selfieStageRef = useRef(0);
  const selfieChallengeRunRef = useRef(0);
  const retakeReviewRef = useRef(false);

  const currentDoc = useMemo(() => getIdentityDocument(docType), [docType]);
  const returnTo = location.state?.returnTo || '/dashboard';
  const current = liveResult || verification;
  const showStatus = !retrying && (step === 'status' || (step === 'start' && current?.status && current.status !== 'none'));
  const needsPhone = typeof window !== 'undefined' && (window.matchMedia('(min-width: 768px)').matches || !navigator.mediaDevices?.getUserMedia);
  const selfieStages = useMemo(() => [{ key: SELFIE_POSES.includes(selfieChallenge.pose) ? selfieChallenge.pose : 'smile' }], [selfieChallenge.pose]);

  useEffect(() => {
    trackKyc('identity_route_open', location.state?.source || 'direct');
  }, [location.state?.source]);

  useEffect(() => {
    if (current?.status === 'verified' && !user?.verified) refreshUser();
  }, [current?.status, user?.verified, refreshUser]);

  useEffect(() => {
    if (!needsPhone) return undefined;
    QRCode.toDataURL(`${window.location.origin}/verify-identity`, { margin: 1, width: 224 })
      .then(setQrCode)
      .catch(() => setQrCode(''));
    return undefined;
  }, [needsPhone]);

  useEffect(() => () => {
    stopCameraStream(streamRef.current);
  }, []);
  // The liveness loop reads the stage through a ref: keeping it in the camera effect's deps
  // would tear the stream down and restart it every time a stage completed.

  useEffect(() => {
    selfieStageRef.current = selfieStage;
  }, [selfieStage]);

  useEffect(() => {
    const captureMode = step === 'capture';
    if (!captureMode || needsPhone) {
      stopCameraStream(streamRef.current);
      streamRef.current = null;
      return undefined;
    }
    let cancelled = false;
    let localInterval = null;
    let localGrace = null;
    let localStream = null;
    let localDetector = null;
    const clearLocalTimers = () => {
      clearInterval(localInterval);
      clearTimeout(localGrace);
    };
    async function boot() {
      try {
        setCameraError('');
        // A document keeps only the guide rectangle, so ask for the largest frame available; a
        // selfie is judged on geometry, and a smaller frame keeps the landmarker loop responsive.
        const isSelfie = activeFrame === 'selfie';
        const stream = await startCameraStream(isSelfie
          ? { facingMode: 'user' }
          : { facingMode: 'environment', width: 1920, height: 1080 });
        if (cancelled) {
          stopCameraStream(stream);
          return;
        }
        localStream = stream;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          if (cancelled) return;
        }
              // Past the last stage there is nothing left to ask for, and re-reading would let a
              // dropped pose walk the counter back below the gate the user already cleared.
        if (isSelfie) {
          await bootSelfieGuidance();
          return;
        }
        localInterval = window.setInterval(() => {
          if (!videoRef.current) return;
          const quality = readFrameQuality(videoRef.current, guideRef.current);
          if (quality.brightness < 75) setQualityHintKey('tooDark');
          else if (quality.sharpness < 8) setQualityHintKey('blurry');
          else setQualityHintKey(activeFrame === 'back' ? 'back' : 'front');
        }, 500);
      } catch (error) {
        if (cancelled) return;
        const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
        setCameraError(denied
          ? t('verifyIdentity.capture.cameraDenied')
          : t('verifyIdentity.capture.cameraFailed'));
      }
    }
    async function bootSelfieGuidance() {
      setGuidanceOff(false);
      setStagesBypassed(false);
      const armStallTimer = () => {
        clearTimeout(localGrace);
        localGrace = window.setTimeout(() => {
          if (!cancelled) setStagesBypassed(true);
        }, LIVENESS_STALL_MS);
      };
      armStallTimer();
      try {
        localDetector = await loadFaceLandmarker();
        if (cancelled) return;
        localInterval = window.setInterval(() => {
          if (!videoRef.current || !localDetector) return;
          const stageIndex = selfieStageRef.current;
          if (stageIndex >= selfieStages.length) return;
          const result = localDetector.detectForVideo(videoRef.current, performance.now());
          const guidance = readSelfieGuidance(result, selfieStages[stageIndex].key);
          const finishing = guidance.ok && stageIndex + 1 >= selfieStages.length;
          setSelfieHintKey(finishing ? 'allPassed' : guidance.messageKey);
          if (guidance.ok) {
            armStallTimer();
            setSelfieStage((currentStage) => Math.min(currentStage + 1, selfieStages.length));
          }
        }, 650);
      } catch {
        if (cancelled) return;
        setGuidanceOff(true);
        setSelfieHintKey('unavailable');
      }
    }
    boot();
    return () => {
      cancelled = true;
      clearLocalTimers();
      stopCameraStream(localStream);
      if (streamRef.current === localStream) streamRef.current = null;
    };
  }, [activeFrame, needsPhone, retryToken, selfieStages, step, t]);

  function leave() {
    navigate(returnTo, { replace: true });
  }

  function selectDocType(nextDocType) {
    setDocType(nextDocType);
    clearCaptures();
    setDuplicateConflict(null);
  }

  function startCapture() {
    setRetrying(true);
    setReviewError('');
    setWithdrawError('');
    setDuplicateConflict(null);
    setDisputeError('');
    setActiveFrame('front');
    setStep('capture');
  }

  async function captureDocument(side) {
    if (!videoRef.current) return;
    const file = await capturePreparedImage(videoRef.current, { fileName: `${docType}-${side}.jpg`, document: true, guide: guideRef.current });
    setCapture(side, file);
    if (side === 'front') {
      if (retakeReviewRef.current) {
        retakeReviewRef.current = false;
        setStep('review');
        return;
      }
      if (currentDoc.needsBack) setActiveFrame('back');
      else await enterSelfie();
      return;
    }
    if (retakeReviewRef.current) {
      retakeReviewRef.current = false;
      setStep('review');
      return;
    }
    await enterSelfie();
  }

  async function loadSelfieChallenge() {
    const run = ++selfieChallengeRunRef.current;
    try {
      const challenge = await getIdentityChallenge();
      const validPose = SELFIE_POSES.includes(challenge?.pose);
      const pose = validPose ? challenge.pose : randomSelfiePose();
      if (run === selfieChallengeRunRef.current) setSelfieChallenge({ pose, token: validPose ? (challenge?.token || null) : null, expiresAt: validPose ? (challenge?.expiresAt || null) : null });
    } catch {
      if (run === selfieChallengeRunRef.current) setSelfieChallenge({ pose: randomSelfiePose(), token: null, expiresAt: null });
    }
  }

  async function enterSelfie(noticeKey = '') {
    setSelfieStage(0);
    setSelfieHintKey('initial');
    setSelfieNoticeKey(noticeKey);
    setGuidanceOff(false);
    setStagesBypassed(false);
    await loadSelfieChallenge();
    setActiveFrame('selfie');
  }

  async function captureSelfie() {
    if (!videoRef.current) return;
    const file = await capturePreparedImage(videoRef.current, { fileName: 'identity-selfie.jpg', document: false });
    setCapture('selfie', file);
    retakeReviewRef.current = false;
    setStep('review');
  }

  async function submit() {
    setSubmitting(true);
    setReviewError('');
    try {
      const result = await verification.submitVerification({
        docType,
        consent: consented,
        liveness: livenessValue(),
        challenge: selfieChallenge.token || undefined,
        captures: {
          front: captures.front?.file,
          back: captures.back?.file,
          selfie: captures.selfie?.file,
        },
      });
      setLiveResult(result);
      setRetrying(false);
      clearCaptures();
      setStep('status');
    } catch (error) {
      // Set the message FIRST: if a reload starts, it is never read; if the heal is refused, it is.
      const code = String(error?.code || '').toLowerCase();
      if (code === 'identity_challenge_invalid') {
        resetCapture('selfie');
        retakeReviewRef.current = false;
        await enterSelfie('challengeExpired');
        setStep('capture');
      } else if (code === 'identity_already_registered') {
        setDuplicateConflict({ state: 'ready' });
      } else {
        setReviewError(submitFailureMessage(error, t));
      }
      healStaleShell(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDispute() {
    if (!duplicateConflict) return;
    setDisputeSubmitting(true);
    setDisputeError('');
    try {
      await disputeIdentityVerification({
        note: disputeNote.trim(),
      });
      setDuplicateConflict({ ...duplicateConflict, state: 'sent' });
      setDisputeOpen(false);
      setDisputeNote('');
    } catch (error) {
      if (error?.status === 409 && String(error?.code || '').toLowerCase() === 'identity_dispute_open') {
        setDuplicateConflict({ ...duplicateConflict, state: 'open' });
        setDisputeOpen(false);
        setDisputeNote('');
      } else {
        setDisputeError(submitFailureMessage(error, t));
      }
      healStaleShell(error);
    } finally {
      setDisputeSubmitting(false);
    }
  }

  async function withdraw() {
    setWithdrawError('');
    try {
      const next = await verification.withdrawVerification();
      setLiveResult(next);
      setRetrying(true);
      setWithdrawing(false);
      setConsented(false);
      clearCaptures();
      setStep('start');
    } catch (error) {
      setWithdrawError(submitFailureMessage(error, t));
      setWithdrawing(false);
      healStaleShell(error);
    }
  }

  function retryFromStatus() {
    setRetrying(true);
    setConsented(false);
    clearCaptures();
    setDuplicateConflict(null);
    setStep('start');
  }

    // Leaving is all that remains once a case is pending or verified. A rejected retry restarts at
    // consent: `consented` is component state and the server refuses a submission without it.
  function retake(frame) {
    retakeReviewRef.current = step === 'review';
    resetCapture(frame);
    setDuplicateConflict(null);
    setDisputeError('');
    if (frame === 'selfie') void enterSelfie();
    else setActiveFrame(frame);
    setStep('capture');
  }

  function retakeActive() {
    retake(activeFrame);
  }

  function livenessValue() {
    if (guidanceOff) return 'unavailable';
    if (stagesBypassed && selfieStage < selfieStages.length) return 'bypassed';
    return 'passed';
  }

  const clearedStages = Math.min(selfieStage, selfieStages.length);
  const livenessDone = clearedStages >= selfieStages.length;
  // The stages are a precondition only while they can be cleared: if the model never loaded or has
  // had its grace period, holding the button hostage strands the user rather than protecting anyone.
  const livenessUnenforceable = guidanceOff || stagesBypassed;
  const liveness = {
    done: livenessDone,
    unavailable: guidanceOff,
    bypassed: stagesBypassed,
    blocked: activeFrame === 'selfie' && !livenessDone && !livenessUnenforceable,
    stageLabel: t(`verifyIdentity.capture.selfieStages.${selfieStages[Math.min(selfieStage, selfieStages.length - 1)]?.key || 'smile'}`),
    stages: selfieStages.map((stageItem, index) => ({
      ...stageItem,
      title: t(`verifyIdentity.capture.selfieStages.${stageItem.key}`),
      state: index < clearedStages ? 'done' : (index === clearedStages ? 'active' : 'pending'),
    })),
  };

  if (needsPhone) {
    return (
          /* Headed by the questions people actually ask, not by policy labels. */
      <VerifyShell title={t('verifyIdentity.shell.verifyTitle')} stepIndex={STEP_INDEX.start} onClose={leave}>
        <PhoneHandoffScreen qrCode={qrCode} />
      </VerifyShell>
    );
  }

  if (showStatus) {
    return (
      <VerifyShell title={t('verifyIdentity.shell.statusTitle')} stepIndex={STEP_INDEX.status} onClose={leave}>
        <StatusScreen
          status={current}
          verifiedName={current?.verifiedName || user?.name || ''}
          withdrawing={withdrawing}
          withdrawError={withdrawError}
          onDone={leave}
          onRetry={retryFromStatus}
          onWithdraw={() => setWithdrawing(true)}
          onCancelWithdraw={() => setWithdrawing(false)}
          onConfirmWithdraw={withdraw}
        />
      </VerifyShell>
    );
  }

  if (step === 'review') {
    return (
      <VerifyShell title={t('verifyIdentity.shell.reviewTitle')} stepIndex={STEP_INDEX.review} onBack={() => setStep('capture')} onClose={leave}>
        <ReviewScreen
          doc={currentDoc}
          captures={captures}
          reviewError={reviewError}
          duplicateConflict={duplicateConflict}
          disputeOpen={disputeOpen}
          disputeNote={disputeNote}
          disputeSubmitting={disputeSubmitting}
          disputeError={disputeError}
          submitting={submitting}
          onRetake={retake}
          onSubmit={submit}
          onOpenDispute={() => { setDisputeError(''); setDisputeOpen(true); }}
          onCloseDispute={() => { if (!disputeSubmitting) setDisputeOpen(false); }}
          onDisputeNoteChange={setDisputeNote}
          onSubmitDispute={submitDispute}
        />
      </VerifyShell>
    );
  }

/* Square rather than a gradient circle: the thing being earned is a stamp on a record, and a glowing orb is the shape
   every onboarding screen already uses. */
  if (step === 'capture') {
    return (
      <VerifyShell title={activeFrame === 'selfie' ? t('verifyIdentity.capture.selfieTitle') : t(`verifyIdentity.documents.${currentDoc.key}.label`)} stepIndex={STEP_INDEX.capture} onBack={() => setStep('start')} onClose={leave}>
        <CaptureScreen
          doc={currentDoc}
          captures={captures}
          activeFrame={activeFrame}
          videoRef={videoRef}
          guideRef={guideRef}
          qualityHint={t(`verifyIdentity.capture.quality.${qualityHintKey}`)}
          selfieHint={t(`verifyIdentity.capture.selfie.${selfieHintKey || 'initial'}`)}
          selfieNotice={selfieNoticeKey ? t(`verifyIdentity.capture.selfie.${selfieNoticeKey}`) : ''}
          cameraError={cameraError}
          liveness={liveness}
          onCapture={() => (activeFrame === 'selfie' ? captureSelfie() : captureDocument(activeFrame))}
          onRetryCamera={() => setRetryToken((token) => token + 1)}
          onRetakeActive={retakeActive}
        />
      </VerifyShell>
    );
  }

  return (
    <VerifyShell title={t('verifyIdentity.shell.verifyTitle')} stepIndex={STEP_INDEX.start} onClose={leave}>
      <StartScreen
        docType={docType}
        consented={consented}
        onDocTypeChange={selectDocType}
        onConsentChange={setConsented}
        onStart={startCapture}
      />
    </VerifyShell>
  );
}
