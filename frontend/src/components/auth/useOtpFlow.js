import { useCallback, useEffect, useRef, useState } from 'react';

/* Simulated dispatch: the 700ms delay preserves the "Sending…" affordance that a real network
   round-trip provides, so flows still backed by mocks feel unchanged. */
const mockDispatch = () => new Promise((resolve) => setTimeout(resolve, 700));

/**
 * Send-OTP + 30s resend-timer state machine, shared by sign in / sign up and by several non-auth
 * verification flows (owner consent, society hub, share-a-flat).
 *
 * The hook stays deliberately domain-agnostic: pass `dispatch` to actually send a code. Auth pages
 * pass the auth service; every other flow is still mocked and gets the simulated dispatch by
 * default. Without this seam a single shared hook would have to send *login* OTPs on behalf of
 * flows that are verifying something else entirely.
 *
 * @param {(mobile: string) => Promise<any>} [dispatch]
 */
export function useOtpFlow(dispatch = mockDispatch) {
  const [otpSent, setOtpSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const timer = useRef(null);

  // Held in a ref so callers can pass an inline arrow without re-creating `send` every render.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const startTimer = useCallback(() => {
    setSeconds(30);
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(timer.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  const send = useCallback(async (mobile) => {
    setSending(true);
    setSendError(null);
    try {
      await dispatchRef.current(mobile);
      setOtpSent(true);
      startTimer();
    } catch (err) {
      // Leave `otpSent` untouched: on a rate-limit or network failure the user must stay on the
      // "send" step rather than facing a code box no code will ever arrive for.
      setSendError(err?.message || 'Could not send the OTP. Please try again.');
    } finally {
      setSending(false);
    }
  }, [startTimer]);

  // Resend genuinely re-dispatches — the previous code may have expired — and clears the stale entry.
  const resend = useCallback((mobile) => {
    setOtp('');
    setOtpError(false);
    return send(mobile);
  }, [send]);

  useEffect(() => () => clearInterval(timer.current), []);

  return {
    otpSent, sending, otp, setOtp, otpError, setOtpError, sendError, setSendError,
    send, resend, seconds, canResend: otpSent && seconds === 0,
  };
}
