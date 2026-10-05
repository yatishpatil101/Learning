import { useEffect, useRef, useState } from 'react';
import { openCashfreeCheckout } from '../../../../lib/cashfree.js';
import { getServiceRequest, simulateServiceRequestPayment } from '../../../../services/serviceRequestService.js';
import { fmt } from './helpers.js';

const PAYMENT_POLL_BACKOFF_MS = [500, 1000, 2000, 3000, 3000];

export function useRaPayment({ tr, toast }) {
  // Re-armed in the effect body, not just cleared in the cleanup: StrictMode mounts, cleans up and
  // re-mounts, so a cleanup-only ref would stay `false` for the rest of the page's life.
  const mountedRef = useRef(true);
  const pollTimerRef = useRef(null);
  const pollWakeRef = useRef(null);
  // "We couldn't confirm it" (budget spent) versus "we're checking" — collapsing them puts the
  // failure wording on screen during the successful case.
  const [paymentPending, setPaymentPending] = useState(false);
  const [paymentConfirming, setPaymentConfirming] = useState(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
      // Resolved rather than abandoned: an awaited promise that never settles pins the whole
      // submit closure — form state and uploaded document data URLs — in memory.
      const wake = pollWakeRef.current;
      pollWakeRef.current = null;
      if (wake) wake();
    };
  }, []);
  // Callers must re-check `mountedRef` after the await: waking early means "stop".

  const sleepBeforeRetry = (ms) => new Promise((resolve) => {
    pollWakeRef.current = resolve;
    pollTimerRef.current = setTimeout(() => {
      pollTimerRef.current = null;
      pollWakeRef.current = null;
      resolve();
    }, ms);
  });

  const payAndConfirm = async (checkout, expectedTotal) => {
    if (!checkout?.paymentSessionId) return;
    const charged = Number(checkout.amount);
    if (Number.isFinite(charged) && charged > 0 && expectedTotal != null && charged !== expectedTotal) {
      toast(tr('services.ra.cost.chargedDiffers', { amount: fmt(charged) }), 'info');
    }
    let opened = null;
    try {
      opened = await openCashfreeCheckout(checkout.paymentSessionId);
    } catch (err) {
      // The request exists and is still payable from the tracker, so this is not a lost submission.
      console.error('Rent Agreement checkout could not open');
      if (import.meta.env.DEV) console.error(err);
    }
    // Dialogs auto-dismiss under Playwright, so e2e keeps the unpaid path.
    if (opened?.mock && import.meta.env.DEV && window.confirm('Local mock payment: mark this rent agreement as paid?')) {
      await simulateServiceRequestPayment(checkout.id, 'paid').catch((err) => console.error('Mock payment failed', err?.status));
    }
    // The modal closing is not proof of payment — only the webhook is (§ 5.10 in the flow doc).
    setPaymentConfirming(true);
    let status = 'awaiting_payment';
    for (let attempt = 0; attempt <= PAYMENT_POLL_BACKOFF_MS.length; attempt++) {
      if (attempt > 0) {
        await sleepBeforeRetry(PAYMENT_POLL_BACKOFF_MS[attempt - 1]);
        if (!mountedRef.current) break;
      }
      const settled = await getServiceRequest(checkout.id).catch(() => null);
      if (settled?.status) status = settled.status;
      if (!mountedRef.current || status !== 'awaiting_payment') break;
    }
    if (mountedRef.current) {
      setPaymentConfirming(false);
      setPaymentPending(status === 'awaiting_payment');
    }
    return status;
  };

  const resetPayment = () => { setPaymentPending(false); setPaymentConfirming(false); };

  return { mountedRef, paymentPending, paymentConfirming, payAndConfirm, resetPayment };
}
