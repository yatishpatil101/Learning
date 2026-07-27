// Temporary product-market-fit (PMF) test instrumentation.
//
// Everything here is gated behind VITE_PMF_MODE. When the flag is off — which is
// the default, including all local development — every export is a no-op: no GA
// script is loaded, no banner renders, no lead is captured. The normal dev flow
// is therefore completely untouched. The overlay only activates on the Netlify
// PMF build where VITE_PMF_MODE=on.

const ON = import.meta.env.VITE_PMF_MODE === 'on';
const GA_ID = import.meta.env.VITE_GA_ID || '';

export const pmfEnabled = ON;

let gaLoaded = false;

function ensureGA() {
  if (!ON || !GA_ID || gaLoaded || typeof window === 'undefined') return;
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
}

// Fire a GA4 event for the PMF funnel (landing / view_listing / contact_click /
// notify_submit). No-op when the flag is off.
export function track(event, params = {}) {
  if (!ON) return;
  ensureGA();
  try { window.gtag?.('event', event, params); } catch { /* analytics must never break the app */ }
}

// Capture a fake-door lead via Netlify Forms — no backend. A hidden static form
// named "pmf-lead" in index.html lets Netlify's deploy bot register the form;
// here we POST url-encoded to the site root (same-origin, allowed by CSP).
export async function captureLead(fields = {}) {
  if (!ON) return { ok: false, skipped: true };
  const body = new URLSearchParams({ 'form-name': 'pmf-lead', ...fields });
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
