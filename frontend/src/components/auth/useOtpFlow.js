import { useCallback, useEffect, useRef, useState } from 'react';

/* Simulated dispatch for the flows still on mocks: the 700ms delay preserves the "Sending…"
   affordance. Its own cooldown, because nothing here can refuse a resend. */
const mockDispatch = () => new Promise((resolve) => {
  setTimeout(() => resolve({ resendAfterSeconds: 30 }), 700);
});

/* Fallback when a real dispatch says nothing about the gap it wants. Mirrors the server's own
   `OtpSendBudget.SEND_COOLDOWN`, so the pessimistic guess is the deployed one. */
const DEFAULT_RESEND_COOLDOWN_SECONDS = 60;

/**
 * Send-OTP + resend-timer state machine. The countdown is the server's, and `dispatch` keeps the
 * hook domain-agnostic. Rules: docs/flows/consumer/auth.md § OTP flow.
 * @param {(mobile: string) => Promise<{ resendAfterSeconds?: number }|any>} [dispatch]
 */
export function useOtpFlow(dispatch = mockDispatch) {
  const [otpSent, setOtpSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const timer = useRef(null);
  const deadline = useRef(0);
  const session = useRef(0);

  // Held in a ref so callers can pass an inline arrow without re-creating `send` every render.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  /* Counts against the clock, not against interval ticks: the user leaves for their SMS app, and a
     hidden tab's timers are throttled or suspended, so a tick-counter strands them behind the button. */
  const tick = useCallback(() => {
    const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
    setSeconds(left);
    if (left === 0) clearInterval(timer.current);
  }, []);

  const startTimer = useCallback((cooldownSeconds) => {
    clearInterval(timer.current);
    // A zero cooldown is a real answer, not a missing one: local and e2e run a mock sender, so the
    // server allows an immediate resend and a ticking timer would be the only thing forbidding it.
    const total = Number.isFinite(cooldownSeconds) && cooldownSeconds >= 0
      ? Math.round(cooldownSeconds)
      : DEFAULT_RESEND_COOLDOWN_SECONDS;
    deadline.current = Date.now() + total * 1000;
    setSeconds(total);
    if (total === 0) return;
    timer.current = setInterval(tick, 1000);
  }, [tick]);

  /** Dispatch a code. Resolves `true` only if one was actually sent, so a caller can tell a
      delivered code from a refused one without reading `sendError` through a stale closure. */
  const send = useCallback(async (mobile) => {
    const mine = session.current;
    setSending(true);
    setSendError(null);
    try {
      const ack = await dispatchRef.current(mobile);
      // The number can change while the request is in flight. Its old response must not reopen a
      // code box labelled with the replacement number; `reset` advances this generation first.
      if (session.current !== mine) return false;
      setOtpSent(true);
      startTimer(ack?.resendAfterSeconds);
      return true;
    } catch (err) {
      if (session.current !== mine) return false;
      // Leave `otpSent` untouched: on a rate-limit or network failure the user must stay on the
      // "send" step rather than facing a code box no code will ever arrive for.
      setSendError(err?.message || 'Could not send the OTP. Please try again.');
      // A refusal that says when to come back restarts the countdown, or the button stays live and
      // the only response the screen offers is the one that just failed.
      if (Number.isFinite(err?.retryAfterSeconds)) startTimer(err.retryAfterSeconds);
      return false;
    } finally {
      if (session.current === mine) setSending(false);
    }
  }, [startTimer]);

  /* Clears the stale entry only once a replacement is on its way: clearing up front costs the user
     six digits belonging to a code still valid for the rest of its TTL. */
  const resend = useCallback(async (mobile) => {
    const sent = await send(mobile);
    if (sent) {
      setOtp('');
      setOtpError(false);
    }
    return sent;
  }, [send]);

  /** Discard a code when the identity it was sent to changes — a code box for the previous mobile
      is not a valid retry state, and keeping it hides a terminal error. */
  const reset = useCallback(() => {
    session.current += 1;
    clearInterval(timer.current);
    deadline.current = 0;
    setOtpSent(false);
    setSending(false);
    setOtp('');
    setOtpError(false);
    setSendError(null);
    setSeconds(0);
  }, []);

  /* Re-read the clock when the tab returns — on a platform that suspended the interval outright
     while the user was in their messages app, it is the only thing that makes the number right. */
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === 'visible' && deadline.current) tick();
    };
    document.addEventListener('visibilitychange', resync);
    return () => document.removeEventListener('visibilitychange', resync);
  }, [tick]);

  useEffect(() => () => clearInterval(timer.current), []);

  return {
    otpSent, sending, otp, setOtp, otpError, setOtpError, sendError, setSendError,
    send, resend, reset, seconds, canResend: otpSent && seconds === 0,
  };
}
