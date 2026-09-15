/* KYC funnel instrumentation — which value moment converts, tagged with the surface it fired from.
   A console log plus a capped localStorage ring buffer for now; swap for a real analytics sink.
   Never throws: instrumentation must not break a user flow. */
const KEY = 'draazyKycFunnel';
const MAX = 200;

// Defence-in-depth: `extra` carries aggregate flags/counts only, so strip anything PII-shaped —
// the funnel must stay free of mobile/Aadhaar/name/OTP/tokens.
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
