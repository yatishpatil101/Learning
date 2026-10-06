import { CONSENT_CHANGE, hasAnalyticsConsent } from '../components/CookieConsent.jsx';
import { capture } from './productAnalytics.js';

const ON = import.meta.env.VITE_PMF_MODE === 'on';
const GA_ID = import.meta.env.VITE_GA_ID || '';

export const pmfEnabled = ON;

let gaLoaded = false;

function ensureGA() {
  if (!ON || !GA_ID || gaLoaded || typeof window === 'undefined' || !hasAnalyticsConsent()) return;
  gaLoaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_ID);
}

// Call once on app boot. Safe no-op when the flag is off.
export function initPmf() {
  if (!ON) return;
  ensureGA();
  window.addEventListener(CONSENT_CHANGE, () => {
    const granted = hasAnalyticsConsent();
    // GA keeps sending cookieless pings under consent 'denied'; the disable flag stops it entirely.
    if (GA_ID) window[`ga-disable-${GA_ID}`] = !granted;
    window.gtag?.('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' });
    ensureGA();
  });
}

// Product-analytics event (PostHog, and GA4 in the PMF build). Both are no-ops without analytics consent.
export function track(event, params = {}) {
  capture(event, params);
  if (!ON || !hasAnalyticsConsent()) return;
  ensureGA();
  try { window.gtag?.('event', event, params); } catch { /* analytics must never break the app */ }
}

/** A hidden static form named "pmf-lead" in index.html lets Netlify's deploy bot register the form; here we POST
 * url-encoded to the site root (same-origin, allowed by CSP). */
export async function captureLead(fields = {}) {
  if (!ON) return { ok: false, skipped: true };
  const body = new URLSearchParams({
    'form-name': 'pmf-lead',
    context: fields.context || fields.leadType || '',
    property: fields.property || fields.propertyId || '',
    ts: String(Date.now()),
  });
  try {
    const res = await fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}
