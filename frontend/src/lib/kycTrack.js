/* Lightweight KYC funnel instrumentation (mock phase). Logs the verification funnel so we can
   see which value moment converts — badge_cta_impression → click → digilocker_start →
   success/fail → badge_earned — tagged with the `source` surface (post_success, my_listings, …).
   At MVP this is a console log + a capped localStorage ring buffer; swap for a real analytics
   sink when the backend lands. Never throws — instrumentation must not break a user flow. */
const KEY = 'draazyKycFunnel';
const MAX = 200;

// Defence-in-depth: `extra` is meant for aggregate flags/counts only (e.g. { featured }).
// Strip anything that looks like PII so a careless caller can never leak an identifier into
// the console or localStorage — the funnel must stay free of mobile/Aadhaar/name/OTP/tokens.
const PII_KEYS = /(mobile|phone|aadhaar|otp|name|email|token|address|dob)/i;
function sanitize(extra) {
  const out = {};
  for (const [k, v] of Object.entries(extra || {})) {
    if (!PII_KEYS.test(k)) out[k] = v;
  }
  return out;
}

export function trackKyc(event, source = 'unknown', extra = {}) {
  const safeExtra = sanitize(extra);
  const entry = { event, source, at: Date.now(), ...safeExtra };
  try {
    // eslint-disable-next-line no-console
    console.debug('[kyc-funnel]', event, source, safeExtra);
    const buf = JSON.parse(localStorage.getItem(KEY) || '[]');
    buf.push(entry);
    localStorage.setItem(KEY, JSON.stringify(buf.slice(-MAX)));
  } catch { /* instrumentation is best-effort */ }
}
