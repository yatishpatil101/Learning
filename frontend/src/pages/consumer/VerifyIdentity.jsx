import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useVerification } from '../../context/VerificationContext.jsx';
import { trackKyc } from '../../lib/kycTrack.js';
import { capturePreparedImage, capturePreviewUrl, readFrameQuality, releasePreviewUrl, startCameraStream, stopCameraStream } from '../../lib/identity-verification/capture.js';
import { extractIdentityClaims } from '../../lib/identity-verification/ocr.js';
import { loadFaceLandmarker, readSelfieGuidance } from '../../lib/identity-verification/face.js';
import { PROVIDER_LOAD_FAILED, healStaleShell, isDefinitelyOffline } from '../../lib/seamErrors.js';
import Icon from '../../components/Icon.jsx';
import QRCode from 'qrcode';

/* Indian spellings, because every document here is issued in India: a licence is a licence, and
   nobody in Pune is carrying a "Driver's License". `shots` is what the contact sheet counts. */
const DOCUMENTS = [
  { key: 'aadhaar', label: 'Aadhaar', detail: 'Front and back', shots: 'Two photos of the card, then a selfie', recommended: true, needsBack: true, local: true },
  { key: 'pan', label: 'PAN card', detail: 'Front only', shots: 'One photo of the card, then a selfie', needsBack: false, local: true },
  { key: 'driving_licence', label: 'Driving licence', detail: 'Front and back', shots: 'Two photos of the card, then a selfie', needsBack: true, local: true },
];

const SELFIE_STAGES = [
  { key: 'smile', title: 'Smile' },
  { key: 'left', title: 'Turn left' },
  { key: 'right', title: 'Turn right' },
];

/* Measured from the last sign of progress, so somebody simply taking their time is never waved
   through. It has to unlock eventually: liveness is guidance toward a selfie a human reviewer
   judges server-side, so a permanent block buys nothing and strands a poorly-read face. */
const LIVENESS_STALL_MS = 8000;

const GUIDANCE_UNAVAILABLE = 'Face guidance is off. Keep your face centred and well lit, and take the selfie anyway.';

const UNREACHABLE = 'That did not send. Check your connection and try again.';

/* Every refusal this endpoint raises on purpose — too large, not a camera photo, already verified,
   three attempts spent — arrives as a sentence written to be read, so it passes straight through.
   A 5xx does not: the last-resort handler answers "Something went wrong", which on a screen full of
   photos the user just took reads as "one of these is bad" and sends them to retake all three. It is
   ours, it is not retryable by them, and the trace id is the only handle support has on the log line
   that says why. */
function submitFailureMessage(error) {
  /* `healStaleShell` normally reloads out from under this sentence; it is written for the case where
     that is refused — an offline device, or a tab that already reloaded once and still failed. Both
     mean the captures are unsendable from here, so neither sends the user back to the camera. */
  if (error?.code === PROVIDER_LOAD_FAILED) {
    return isDefinitelyOffline()
      ? UNREACHABLE
      : 'Draazy was updated while this page was open. Reload the page and start again.';
  }
  if (!error?.status) return UNREACHABLE;
  if (error.status >= 500) {
    const reference = error.traceId ? ` (reference ${error.traceId})` : '';
    return `Verification is unavailable right now — this is on our side, not your photos. Please try again later${reference}.`;
  }
  return error.message || UNREACHABLE;
}

const STATUS_COPY = {
  none: { title: 'Get the Verified badge', body: 'One document, one selfie, checked by a person on our team.' },
  pending: { title: 'Sent for review', body: 'A reviewer has your photos. You are not verified yet.' },
  verified: { title: 'Verified', body: 'Your badge is live. It shows on your profile and on every listing you post.' },
  rejected: { title: 'Not approved', body: 'A reviewer looked at your photos and could not approve them.' },
};

/* What the badge ACTUALLY does here, taken from the code that implements it rather than from a
   competitor's marketing. Contact is L1-only (ADR-019, `lib/contact.js`), so verification unlocks
   no quota — "unlimited" contacts is Seeker Plus, a paid plan, and claiming it here would sell
   something this flow does not deliver. Ranking and the verified-only inbox are the real ones. */
function badgeBenefits() {
  return [
    { icon: 'badge-check', label: 'The badge on your profile and listings', detail: 'Seekers and owners can see a person was checked, not just a phone number.' },
    { icon: 'trending-up', label: 'Your listings rank higher', detail: 'Verified profiles are lifted in search results.' },
    { icon: 'shield-check', label: 'Reach owners who ask for it', detail: 'Some owners accept contact from verified people only. The badge gets you through.' },
  ];
}

function usePreviewStore() {
  const [captures, setCaptures] = useState({ front: null, back: null, selfie: null });
  useEffect(() => () => {
    Object.values(captures).forEach((item) => releasePreviewUrl(item?.url));
  }, [captures]);
  const setCapture = (key, file) => setCaptures((current) => {
    releasePreviewUrl(current[key]?.url);
    return { ...current, [key]: { file, url: capturePreviewUrl(file) } };
  });
  const resetCapture = (key) => setCaptures((current) => {
    releasePreviewUrl(current[key]?.url);
    return { ...current, [key]: null };
  });
  return { captures, setCapture, resetCapture, setCaptures };
}

export default function VerifyIdentity() {
  const navigate = useNavigate();
  const location = useLocation();
  const verification = useVerification();
  const { captures, setCapture, resetCapture } = usePreviewStore();
  const [step, setStep] = useState('intro');
  const [docType, setDocType] = useState('aadhaar');
  const [consented, setConsented] = useState(false);
  const [claims, setClaims] = useState({ number: null, name: null, dob: null });
  const [ocrBusy, setOcrBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [qualityHint, setQualityHint] = useState('Line the card up inside the frame.');
  const [selfieHint, setSelfieHint] = useState('Bring your face into the oval.');
  const [selfieStage, setSelfieStage] = useState(0);
  // Two separate reasons the stages may be unenforceable, kept apart because they say different
  // things to the user: the model never loaded, or it loaded and cannot read this face in time.
  const [guidanceOff, setGuidanceOff] = useState(false);
  const [stagesBypassed, setStagesBypassed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [liveResult, setLiveResult] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const videoRef = useRef(null);
  const guideRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const intervalRef = useRef(null);
  const graceRef = useRef(null);
  const selfieStageRef = useRef(0);

  const currentDoc = useMemo(() => DOCUMENTS.find((item) => item.key === docType) || DOCUMENTS[0], [docType]);
  const returnTo = location.state?.returnTo || '/dashboard';
  const current = liveResult || verification;
  const needsPhone = typeof window !== 'undefined' && (window.matchMedia('(min-width: 768px)').matches || !navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    trackKyc('identity_route_open', location.state?.source || 'direct');
  }, [location.state?.source]);

  useEffect(() => {
    if (!needsPhone) return undefined;
    QRCode.toDataURL(`${window.location.origin}/verify-identity`, { margin: 1, width: 224 })
      .then(setQrCode)
      .catch(() => setQrCode(''));
    return undefined;
  }, [needsPhone]);

  useEffect(() => () => {
    clearInterval(intervalRef.current);
    clearTimeout(graceRef.current);
    detectorRef.current?.close?.();
    stopCameraStream(streamRef.current);
  }, []);

  // The liveness loop reads the stage through a ref: keeping it in the camera effect's deps
  // would tear the stream down and restart it every time a stage completed.
  useEffect(() => {
    selfieStageRef.current = selfieStage;
  }, [selfieStage]);

  useEffect(() => {
    const captureMode = step === 'capture-front' || step === 'capture-back' || step === 'selfie';
    if (!captureMode || needsPhone) {
      clearInterval(intervalRef.current);
      stopCameraStream(streamRef.current);
      streamRef.current = null;
      return undefined;
    }
    let cancelled = false;
    async function boot() {
      try {
        setCameraError('');
        // A document keeps only the guide rectangle, so ask for the largest frame available; a
        // selfie is judged on geometry, and a smaller frame keeps the landmarker loop responsive.
        const stream = await startCameraStream(step === 'selfie'
          ? { facingMode: 'user' }
          : { facingMode: 'environment', width: 1920, height: 1080 });
        if (cancelled) {
          stopCameraStream(stream);
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (step === 'selfie') {
          setGuidanceOff(false);
          setStagesBypassed(false);
          const armStallTimer = () => {
            clearTimeout(graceRef.current);
            graceRef.current = window.setTimeout(() => setStagesBypassed(true), LIVENESS_STALL_MS);
          };
          armStallTimer();
          try {
            detectorRef.current = await loadFaceLandmarker();
            intervalRef.current = window.setInterval(() => {
              if (!videoRef.current || !detectorRef.current) return;
              const stageIndex = selfieStageRef.current;
              // Past the last stage there is nothing left to ask for, and re-reading would let a
              // dropped pose walk the counter back below the gate the user already cleared.
              if (stageIndex >= SELFIE_STAGES.length) return;
              const result = detectorRef.current.detectForVideo(videoRef.current, performance.now());
              const guidance = readSelfieGuidance(result, SELFIE_STAGES[stageIndex].key);
              const finishing = guidance.ok && stageIndex + 1 >= SELFIE_STAGES.length;
              setSelfieHint(finishing ? 'All checks passed — capture your selfie.' : guidance.message);
              if (guidance.ok) {
                armStallTimer();
                setSelfieStage((currentStage) => Math.min(currentStage + 1, SELFIE_STAGES.length));
              }
            }, 650);
          } catch {
            detectorRef.current = null;
            setGuidanceOff(true);
            setSelfieHint(GUIDANCE_UNAVAILABLE);
          }
          return;
        }
        intervalRef.current = window.setInterval(() => {
          if (!videoRef.current) return;
          const quality = readFrameQuality(videoRef.current, guideRef.current);
          if (quality.brightness < 75) setQualityHint('Too dark to read. Find brighter light.');
          else if (quality.sharpness < 8) setQualityHint('Hold still — the text has to be sharp.');
          else setQualityHint(step === 'capture-back' ? 'Turn the card over. Back side up.' : 'Photo side up. Lay it flat.');
        }, 500);
      } catch (error) {
        const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
        setCameraError(denied
          ? 'The camera is blocked for this site. Allow it in your browser settings, then try again.'
          : (error?.message || 'The camera would not start.'));
      }
    }
    boot();
    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
      clearTimeout(graceRef.current);
      stopCameraStream(streamRef.current);
      streamRef.current = null;
    };
  }, [needsPhone, retryToken, step]);

  async function captureDocument(side) {
    if (!videoRef.current) return;
    const file = await capturePreparedImage(videoRef.current, { fileName: `${docType}-${side}.jpg`, document: true, guide: guideRef.current });
    setCapture(side, file);
    if (side === 'front' && currentDoc.needsBack) setStep('capture-back');
    else if (side === 'front') setStep('selfie');
    else setStep('selfie');
  }

  async function captureSelfie() {
    if (!videoRef.current) return;
    const file = await capturePreparedImage(videoRef.current, { fileName: 'identity-selfie.jpg', document: false, guide: guideRef.current });
    setCapture('selfie', file);
    setStep('review');
    setOcrBusy(true);
    try {
      const nextClaims = await extractIdentityClaims(captures.front?.file || captures.back?.file || file, docType);
      setClaims(nextClaims);
    } catch {
      setClaims({ number: null, name: null, dob: null });
    } finally {
      setOcrBusy(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    setReviewError('');
    try {
      const result = await verification.submitVerification({
        docType,
        consent: consented,
        claims,
        captures: {
          front: captures.front?.file,
          back: captures.back?.file,
          selfie: captures.selfie?.file,
        },
      });
      setLiveResult(result);
      setStep('status');
    } catch (error) {
      setReviewError(submitFailureMessage(error));
      // Set the message FIRST: if a reload starts, it is never read; if the heal is refused, it is.
      healStaleShell(error);
    } finally {
      setSubmitting(false);
    }
  }

  function leave() {
    navigate(returnTo, { replace: true });
  }

  if (needsPhone) {
    return (
      <Shell title="Verify identity" onClose={leave}>
        <div className="px-6 pb-8 pt-9">
          <Seal tone="phone" />
          <h1 className="mt-5 text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em]">Finish this on your phone</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">
            Every step here is a photo, so it needs the camera you hold. Scan this with your phone
            and sign in there. The code carries no login and no document data.
          </p>
          {qrCode && (
            <img
              src={qrCode}
              alt="QR code to open verification on your phone"
              className="mx-auto mt-7 h-52 w-52 rounded-xl bg-white p-3"
            />
          )}
          <p className="mt-7 border-t border-white/10 pt-4 text-xs leading-6 text-[var(--text-subtle)]">
            Already on a phone and still seeing this? The browser is reporting no camera. Check this
            site&apos;s permissions, then reopen the page.
          </p>
        </div>
      </Shell>
    );
  }

  const statusCopy = STATUS_COPY[current?.status || 'none'];
  const showStatus = step === 'status' || (step === 'intro' && current?.status && current.status !== 'none');

  if (step === 'intro' || step === 'status') {
    const tone = showStatus ? (current?.status || 'none') : 'none';
    const rejected = showStatus && current?.status === 'rejected';
    // Leaving is all that remains once a case is pending or verified. A rejected retry restarts at
    // consent: `consented` is component state and the server refuses a submission without it.
    const onPrimary = () => (showStatus && !rejected ? leave() : setStep('consent'));
    return (
      <Shell title={step === 'status' ? 'Identity status' : 'Verify identity'} onClose={leave}>
        <div className="px-6 pb-8 pt-8">
          <Seal tone={tone} />
          <h1 className="mt-5 text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em]">{showStatus ? statusCopy.title : STATUS_COPY.none.title}</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">{showStatus ? statusCopy.body : STATUS_COPY.none.body}</p>

          {showStatus && current?.rejectionReason && (
            <div className="mt-6 rounded-xl border border-[var(--rose)]/25 bg-[var(--rose)]/[0.07] px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">Review outcome</p>
              <p className="mt-2 text-sm leading-6">{current.rejectionNote || current.rejectionReason}</p>
              {Number.isFinite(current.attemptsRemaining) && (
                <p className="mt-3 font-mono text-xs tabular-nums text-[var(--text-subtle)]">Attempts left: {current.attemptsRemaining}</p>
              )}
            </div>
          )}
          {showStatus && (current?.docLast4 || current?.retryAfter) && (
            <dl className="mt-5 border-t border-white/10 pt-4 text-xs">
              {current?.docLast4 && <MetaRow label="Document" value={`•••• ${current.docLast4}`} />}
              {current?.retryAfter && <MetaRow label="Retry after" value={new Date(current.retryAfter).toLocaleString()} />}
            </dl>
          )}

          {!showStatus && (
            <>
              <ul className="mt-7 space-y-px overflow-hidden rounded-xl border border-white/10">
                {badgeBenefits().map((item) => (
                  <li key={item.label} className="flex items-start gap-3.5 bg-white/[0.04] px-4 py-4">
                    <Icon name={item.icon} aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--teal-3)]" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-6">{item.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--text-subtle)]">{item.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs leading-6 text-[var(--text-subtle)]">
                This never blocks contact. Verification is a badge, not a wall — you can browse,
                enquire and list without it.
              </p>
              <p className="mt-4 flex items-start gap-2.5 text-xs leading-6 text-[var(--text-muted)]">
                <Icon name="camera" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-subtle)]" />
                <span>Have an Aadhaar, PAN card or driving licence to hand, and stand somewhere bright.</span>
              </p>
            </>
          )}

          <button
            type="button"
            onClick={onPrimary}
            className="btn btn-primary btn-lg mt-7 w-full"
          >
            {showStatus
              ? (rejected ? 'Try again' : 'Done')
              : 'Start verification'}
          </button>
        </div>
      </Shell>
    );
  }

  if (step === 'consent') {
    return (
      <Shell title="Privacy and consent" onBack={() => setStep('intro')} onClose={leave}>
        <div className="px-6 pb-8 pt-8">
          <h1 className="text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em]">Before you send anything</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">Four things worth knowing. They take longer to happen than to read.</p>
          {/* Headed by the questions people actually ask, not by policy labels. "Limited scope"
              tells a reader nothing; "What this does not prove" tells them exactly what they are
              agreeing to and what they are not getting. */}
          <div className="mt-7 space-y-px overflow-hidden rounded-xl border border-white/10">
            <ConsentLine title="What we collect" body="Photos of your document, one selfie, and the fields our reader lifts off the card. Nothing else from your phone." />
            <ConsentLine title="Who sees it" body="Trained reviewers on our team. Not other seekers, not owners, and never anyone you contact through the app." />
            <ConsentLine title="How long we keep it" body="Images are deleted seven days after a decision. What stays is the last four digits, a hash, the reviewer's note and the outcome." />
            <ConsentLine title="What this does not prove" body="That you are a real person — not that you own any property, and not as a legal identity check. You can ask support to delete the record at any time." />
          </div>
          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-[var(--text-muted)] transition-colors hover:border-white/20">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[var(--teal-2)]"
            />
            <span>I agree to these images being collected and reviewed to verify who I am, and deleted seven days after a decision.</span>
          </label>
          <button type="button" disabled={!consented} onClick={() => setStep('document')} className="btn btn-primary btn-lg mt-6 w-full">
            Agree and continue
          </button>
        </div>
      </Shell>
    );
  }

  if (step === 'document') {
    return (
      <Shell title="Choose document" onBack={() => setStep('consent')} onClose={leave}>
        <div className="px-6 pb-8 pt-8">
          <h1 className="text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em]">Which one do you have?</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">Any of these works. The strip shows how many photos each one needs.</p>
          <div className="mt-7 space-y-3">
            {DOCUMENTS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => { setDocType(item.key); setStep('capture-front'); }}
                className="group flex w-full cursor-pointer items-center gap-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-4 text-left transition-colors hover:border-[var(--teal-2)]/55 hover:bg-[var(--teal-2)]/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal-2)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold">{item.label}</span>
                    {item.recommended && (
                      <span className="rounded bg-[var(--emerald)]/15 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-[var(--emerald)]">Easiest</span>
                    )}
                  </span>
                  <span className="mt-1.5 block text-xs leading-5 text-[var(--text-subtle)]">{item.shots}</span>
                  <ContactSheet frames={sheetFrames(item, {})} size="xs" className="mt-2.5" />
                </span>
                <Icon name="caret-right" aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--text-subtle)] transition-colors group-hover:text-[var(--teal-3)]" />
              </button>
            ))}
          </div>
        </div>
      </Shell>
    );
  }

  if (step === 'review') {
    return (
      <Shell title="Check and send" onBack={() => setStep('selfie')} onClose={leave}>
        <div className="space-y-6 px-6 pb-8 pt-7">
          <div>
            <h1 className="text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em]">Check before you send</h1>
            <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">Every corner readable, face clearly yours. Retake anything that is not.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <PreviewCard label="Front" capture={captures.front} onRetake={() => { resetCapture('front'); setStep('capture-front'); }} />
            {currentDoc.needsBack
              ? <PreviewCard label="Back" capture={captures.back} onRetake={() => { resetCapture('back'); setStep('capture-back'); }} />
              : <div className="grid place-items-center rounded-xl border border-dashed border-white/12 p-4 text-center text-xs leading-5 text-[var(--text-subtle)]">A {currentDoc.label} needs no back photo</div>}
            <div className="col-span-2">
              <PreviewCard label="Selfie" capture={captures.selfie} onRetake={() => { resetCapture('selfie'); setSelfieStage(0); setStep('selfie'); }} />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">Read off the card</p>
            <p className="mt-2 text-xs leading-5 text-[var(--text-subtle)]">Our reader&apos;s best guess, shown so you can spot a bad photo. Reviewers work from the image itself, so blanks here hold nothing up.</p>
            {ocrBusy ? (
              <p className="mt-4 text-sm text-[var(--text-muted)]">Reading the card…</p>
            ) : (
              <dl className="mt-4 space-y-3">
                <DataRow label="Document number" value={claims.number} />
                <DataRow label="Name" value={claims.name} />
                <DataRow label="Date of birth" value={claims.dob} />
              </dl>
            )}
          </div>

          {reviewError && (
            <div role="alert" className="rounded-xl border border-[var(--rose)]/30 bg-[var(--rose)]/10 px-4 py-3 text-sm text-[#fda4af]">{reviewError}</div>
          )}
          <button
            type="button"
            disabled={submitting || !captures.front || !captures.selfie || (currentDoc.needsBack && !captures.back)}
            onClick={submit}
            className="btn btn-primary btn-lg w-full"
          >
            {submitting ? 'Sending…' : 'Send for review'}
          </button>
        </div>
      </Shell>
    );
  }

  const isSelfie = step === 'selfie';
  const clearedStages = Math.min(selfieStage, SELFIE_STAGES.length);
  const livenessDone = clearedStages >= SELFIE_STAGES.length;
  // The stages are a precondition only while they can be cleared: if the model never loaded or has
  // had its grace period, holding the button hostage strands the user rather than protecting anyone.
  const livenessUnenforceable = guidanceOff || stagesBypassed;
  const selfieBlocked = isSelfie && !livenessDone && !livenessUnenforceable;
  const stageLabel = SELFIE_STAGES[Math.min(selfieStage, SELFIE_STAGES.length - 1)]?.title || 'Smile';
  const activeFrame = isSelfie ? 'selfie' : (step === 'capture-front' ? 'front' : 'back');

  return (
    <Shell
      title={isSelfie ? 'Selfie' : currentDoc.label}
      onBack={() => setStep(isSelfie ? (currentDoc.needsBack ? 'capture-back' : 'capture-front') : 'document')}
      onClose={leave}
    >
      <div className="px-6 pb-8 pt-5">
        <ContactSheet frames={sheetFrames(currentDoc, captures)} activeKey={activeFrame} className="mb-4" />

        {/* The guide lives inside this box and nothing else does: `guidedRegion` inverts the
            preview's object-cover transform to decide which pixels get stored, so anything laid
            over the video would either shift that mapping or hide the frame the user is filling.
            Controls therefore sit below it, in normal flow. */}
        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
          {/* Landscape for a document, because every Indian ID this accepts is landscape and a
              portrait preview would centre-crop away most of the sensor width before the card is
              even framed. A face is portrait, so the selfie step keeps the taller frame. */}
          <video ref={videoRef} muted playsInline className={`w-full object-cover ${isSelfie ? 'aspect-[3/4]' : 'aspect-video'}`} />
          {isSelfie ? (
            <div
              ref={guideRef}
              className={`pointer-events-none absolute left-1/2 top-1/2 h-[72%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-4 transition-colors ${livenessDone ? 'border-[var(--emerald)]' : 'border-[var(--teal-2)]'}`}
            />
          ) : (
            /* ID-1, the ISO card shape every one of these documents is issued in. Sized as a share
               of the preview so the target holds at any screen width. */
            <div ref={guideRef} className="pointer-events-none absolute left-1/2 top-1/2 aspect-[1.585] w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-white/90" />
          )}
        </div>

        {isSelfie ? (
          <>
            <ol className="mt-4 grid grid-cols-3 gap-2">
              {SELFIE_STAGES.map((item, index) => {
                const cleared = index < clearedStages;
                const active = index === clearedStages;
                return (
                  <li
                    key={item.key}
                    data-testid={`liveness-stage-${item.key}`}
                    data-state={cleared ? 'done' : (active ? 'active' : 'pending')}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors ${cleared
                      ? 'border-[var(--emerald)]/40 bg-[var(--emerald)]/10 text-[var(--emerald)]'
                      : active
                        ? 'border-[var(--teal-2)]/50 bg-[var(--teal-2)]/10 text-[var(--teal-3)]'
                        : 'border-white/10 bg-white/[0.04] text-[var(--text-subtle)]'}`}
                  >
                    {cleared
                      ? <Icon name="check-circle" aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      : <span aria-hidden="true" className="font-mono text-[0.7rem] tabular-nums opacity-70">{index + 1}</span>}
                    <span>{item.title}</span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3.5 text-center text-sm font-semibold">{livenessDone ? 'All three done' : stageLabel}</p>
            <p role="status" className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-sm leading-6 text-[var(--text-muted)]">
              {selfieHint}
            </p>
            {selfieBlocked && (
              <p className="mt-2 text-center text-xs text-[var(--text-subtle)]">Finish all three to unlock the shutter.</p>
            )}
            {stagesBypassed && !livenessDone && !guidanceOff && (
              <p className="mt-2 flex items-start justify-center gap-2 text-center text-xs leading-5 text-[var(--amber)]">
                <Icon name="alert-triangle" aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>We could not read the checks from your camera. Take the selfie anyway — a reviewer decides.</span>
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mt-4 text-center text-sm font-semibold">All four corners inside the frame</p>
            <p role="status" className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-sm leading-6 text-[var(--text-muted)]">
              {qualityHint}
            </p>
          </>
        )}

        {cameraError ? (
          <div className="mt-5 rounded-xl border border-[var(--amber)]/30 bg-[var(--amber)]/[0.07] px-4 py-4 text-sm leading-6">
            <p className="flex items-center gap-2 font-semibold"><Icon name="camera" aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--amber)]" /> No camera yet</p>
            <p className="mt-1.5 text-[var(--text-muted)]">{cameraError}</p>
            <button type="button" onClick={() => setRetryToken((token) => token + 1)} className="btn btn-secondary mt-4">
              Try the camera again
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              data-testid="capture-button"
              disabled={selfieBlocked}
              onClick={() => (isSelfie ? captureSelfie() : captureDocument(step === 'capture-front' ? 'front' : 'back'))}
              className="btn btn-primary btn-lg mt-5 w-full"
            >
              {isSelfie ? 'Take the selfie' : (step === 'capture-front' ? 'Take the front' : 'Take the back')}
            </button>
            {/* Keyed to THIS step's photo, not to any photo. The old condition was
                `captures.front || captures.back || captures.selfie`, so arriving at the selfie
                step with a front photo in hand offered to retake a selfie that did not exist yet
                — and taking the offer called resetCapture('selfie') and reset the stage counter,
                sending an honest user back through three poses for nothing. */}
            {captures[activeFrame] && (
              <button
                type="button"
                onClick={() => {
                  if (isSelfie) { resetCapture('selfie'); setSelfieStage(0); }
                  else resetCapture(step === 'capture-front' ? 'front' : 'back');
                }}
                className="mt-3 w-full cursor-pointer text-center text-sm text-[var(--text-muted)] underline-offset-4 transition-colors hover:text-white hover:underline"
              >
                {isSelfie ? 'Retake the selfie' : `Retake the ${step === 'capture-front' ? 'front' : 'back'}`}
              </button>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}

/**
 * The one frame every screen in this flow sits in, so the eight steps read as a single journey
 * rather than eight pages that happen to follow each other.
 */
function Shell({ title, onBack, onClose, children }) {
  return (
    <div className="min-h-[100dvh] bg-[var(--brand-dark)] px-4 pb-[calc(1.5rem+var(--dz-safe-b))] pt-[calc(1rem+var(--dz-safe-t))] text-white">
      <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[var(--brand-card)]">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2.5">
          {onBack
            ? <button type="button" onClick={onBack} aria-label="Go back" className="btn btn-icon btn-sm cursor-pointer"><Icon name="arrow-left" aria-hidden="true" className="h-4 w-4" /></button>
            : <span className="w-8" />}
          <span className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">{title}</span>
          {onClose
            ? <button type="button" onClick={onClose} aria-label="Close verification" className="btn btn-icon btn-sm cursor-pointer"><Icon name="x" aria-hidden="true" className="h-4 w-4" /></button>
            : <span className="w-8" />}
        </div>
        {children}
      </div>
    </div>
  );
}

/* The frames this document needs, in the order they get shot. Derived from `needsBack` so the
   sheet and the actual step sequence can never disagree. */
function sheetFrames(doc, captures) {
  const frames = [{ key: 'front', label: 'Front', shape: 'card' }];
  if (doc.needsBack) frames.push({ key: 'back', label: 'Back', shape: 'card' });
  frames.push({ key: 'selfie', label: 'You', shape: 'face' });
  return frames.map((frame) => ({ ...frame, capture: captures?.[frame.key] || null }));
}

/* The contact sheet answers the question a step counter cannot — how many more photos, and of what
   — by being the photos. The `xs` variant renders as hidden spans because it sits inside the
   picker's `<button>`, which may only contain phrasing content, and is decorative there. */
function ContactSheet({ frames, activeKey, size = 'md', className = '' }) {
  const decorative = size === 'xs';
  const List = decorative ? 'span' : 'ol';
  const Item = decorative ? 'span' : 'li';
  const width = decorative ? 'w-11' : 'w-20';
  return (
    <List aria-hidden={decorative || undefined} className={`flex items-end gap-1.5 ${className}`}>
      {frames.map((frame, index) => {
        const active = frame.key === activeKey;
        const shot = Boolean(frame.capture);
        return (
          <Item key={frame.key} className={`${decorative ? 'block ' : ''}${width} shrink-0`}>
            <div
              className={`relative overflow-hidden rounded transition-colors ${frame.shape === 'face' ? 'aspect-[3/4]' : 'aspect-[1.585]'} ${shot
                ? 'border border-[var(--emerald)]/45'
                : active
                  ? 'border-2 border-[var(--teal-2)] bg-[var(--teal-2)]/10'
                  : 'border border-dashed border-white/20 bg-white/[0.03]'}`}
            >
              {shot
                ? <img src={frame.capture.url} alt="" className="h-full w-full object-cover" />
                : (
                  <span aria-hidden="true" className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono tabular-nums ${decorative ? 'text-[0.6rem]' : 'text-xs'} ${active ? 'text-[var(--teal-3)]' : 'text-[var(--text-subtle)]'}`}>
                    {index + 1}
                  </span>
                )}
            </div>
            {!decorative && (
              <p className={`mt-1 text-center text-[0.65rem] font-medium uppercase tracking-[0.1em] ${shot ? 'text-[var(--emerald)]' : active ? 'text-[var(--teal-3)]' : 'text-[var(--text-subtle)]'}`}>
                {frame.label}
              </p>
            )}
          </Item>
        );
      })}
    </List>
  );
}

/* Square rather than a gradient circle: the thing being earned is a stamp on a record, and a
   glowing orb is the shape every onboarding screen already uses. */
function Seal({ tone = 'none' }) {
  const map = {
    verified: { icon: 'badge-check', color: 'var(--emerald)' },
    rejected: { icon: 'shield-alert', color: 'var(--rose)' },
    pending: { icon: 'clock', color: 'var(--amber)' },
    phone: { icon: 'camera', color: 'var(--teal-3)' },
    none: { icon: 'fingerprint', color: 'var(--teal-3)' },
  };
  const { icon, color } = map[tone] || map.none;
  return (
    <div
      aria-hidden="true"
      className="grid h-14 w-14 place-items-center rounded-xl border"
      style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
    >
      <Icon name={icon} className="h-7 w-7" />
    </div>
  );
}

function MetaRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-[var(--text-subtle)]">{label}</dt>
      <dd className="font-mono tabular-nums text-[var(--text-muted)]">{value}</dd>
    </div>
  );
}

function ConsentLine({ title, body }) {
  return (
    <div className="bg-white/[0.04] px-4 py-3.5">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{body}</p>
    </div>
  );
}

function PreviewCard({ label, capture, onRetake }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">{label}</p>
      {capture
        ? <img src={capture.url} alt={`${label} preview`} className="mt-2 h-28 w-full rounded-lg object-cover" />
        : <div className="mt-2 grid h-28 place-items-center rounded-lg border border-dashed border-white/12 text-xs text-[var(--text-subtle)]">Not taken</div>}
      <button type="button" onClick={onRetake} className="mt-2 cursor-pointer text-xs font-semibold text-[var(--teal-3)] transition-colors hover:text-[var(--teal-2)]">Retake</button>
    </div>
  );
}

function DataRow({ label, value }) {
  return (
    <div>
      <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">{label}</dt>
      {/* Monospace because this is machine output a human is being asked to check, and a
          proportional face hides exactly the confusions that matter in it (1/l, 0/O). */}
      <dd className={`mt-1 text-sm ${value ? 'font-mono tabular-nums text-white' : 'text-[var(--text-subtle)]'}`}>{value || 'Nothing readable'}</dd>
    </div>
  );
}