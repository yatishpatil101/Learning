import { useCallback, useEffect, useRef, useState } from 'react';

/* Send-OTP + 30s resend-timer state machine shared by sign in / sign up
   (ports the otpSent / startResendTimer logic). SMS-only mock — any 6 digits pass. */
export function useOtpFlow() {
  const [otpSent, setOtpSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const timer = useRef(null);

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

  const send = useCallback(() => {
    setSending(true);
    setTimeout(() => {
      setSending(false);
      setOtpSent(true);
      startTimer();
    }, 700);
  }, [startTimer]);

  const resend = useCallback(() => {
    setOtp('');
    setOtpError(false);
    startTimer();
  }, [startTimer]);

  useEffect(() => () => clearInterval(timer.current), []);

  return { otpSent, sending, otp, setOtp, otpError, setOtpError, send, resend, seconds, canResend: otpSent && seconds === 0 };
}
