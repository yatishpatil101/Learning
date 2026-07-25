import { useState, useEffect } from 'react';
import { isValidMobile } from '../../../components/MobileField.jsx';
import { isAadhaarVerified, setAadhaarVerified } from '../../../lib/store';
import { AADHAAR_WEIGHT } from './progress.js';

export default function useListingGate({ user, logout, navigate, t }) {
  const [aadhaarVerified, setAadhaarVerifiedState] = useState(false);

  /* gate state — the verification number is the mobile the owner signed in with.
     Aadhaar maps to a single mobile, so pinning verification to the sign-in
     number is our anti-duplicate thumb rule. */
  const signedMobile = String(user?.mobile || '').replace(/\D/g, '').slice(0, 10);
  const enforceSignInMobile = isValidMobile(signedMobile);
  const [gateMobile, setGateMobile] = useState(signedMobile);
  const [gateOtp, setGateOtp] = useState('');
  const [gateOtpSent, setGateOtpSent] = useState(false);
  const [gateSending, setGateSending] = useState(false);
  const [gateVerifying, setGateVerifying] = useState(false);
  const [gateMobileErr, setGateMobileErr] = useState(false);
  const [gateOtpErr, setGateOtpErr] = useState(false);
  const [gateMismatch, setGateMismatch] = useState(false);

  useEffect(() => {
    // Posting requires a completed Aadhaar check — nothing else unlocks the form.
    if (isAadhaarVerified()) setAadhaarVerifiedState(true);
  }, []);

  // Keep the gate locked to the number the owner actually signed in with, so
  // the field can't drift from the identity we verify against.
  useEffect(() => {
    if (signedMobile) setGateMobile(signedMobile);
  }, [signedMobile]);

  /* ---------- gate handlers ---------- */
  const sendGateOtp = () => {
    if (!/^[6-9]\d{9}$/.test(gateMobile)) { setGateMobileErr(true); return; }
    setGateMobileErr(false);
    setGateMismatch(false);
    setGateSending(true);
    setTimeout(() => {
      setGateSending(false);
      setGateOtpSent(true);
    }, 800);
  };
  const verifyGateOtp = () => {
    if (gateOtp.length < 6) { setGateOtpErr(true); return; }
    setGateOtpErr(false);
    setGateVerifying(true);
    setTimeout(() => {
      setAadhaarVerified(gateMobile);
      setGateVerifying(false);
      setAadhaarVerifiedState(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 1000);
  };
  const resendGateOtp = () => {
    setGateOtp('');
    setGateOtpErr(false);
    setGateOtpSent(false);
    setTimeout(sendGateOtp, 50);
  };

  // The owner says the signed-in number isn't their Aadhaar mobile: send them
  // back to sign in with the right one, keeping our one-Aadhaar-one-number rule.
  const reloginWithAadhaar = () => { logout(); navigate('/signin?next=/list-property'); };

  // Verification advances through three stages — number ready, OTP sent,
  // verifying. It drives the SAME momentum meter shown above the tabs, scaled
  // into Aadhaar's 20% share so the bar reaches 20% exactly when identity is
  // confirmed, then continues climbing as listing fields are filled.
  const verifyStage = gateVerifying ? 3 : gateOtpSent ? 2 : 1;
  const aadhaarMeterPct = Math.round((AADHAAR_WEIGHT * verifyStage) / 3); // 7 → 13 → 20
  const gateCheers = [
    t('listProperty.gate.cheer1'),
    t('listProperty.gate.cheer2'),
    t('listProperty.gate.cheer3'),
  ];
  const gateCheer = gateCheers[verifyStage - 1];
  const fmtMobile = (m) => String(m || '').replace(/(\d{5})(\d{5})/, '$1 $2');

  return {
    aadhaarVerified, setAadhaarVerifiedState,
    signedMobile, enforceSignInMobile,
    gateMobile, setGateMobile,
    gateOtp, setGateOtp,
    gateOtpSent, gateSending, gateVerifying,
    gateMobileErr, setGateMobileErr,
    gateOtpErr, gateMismatch, setGateMismatch,
    sendGateOtp, verifyGateOtp, resendGateOtp, reloginWithAadhaar,
    verifyStage, aadhaarMeterPct, gateCheer, fmtMobile,
  };
}
