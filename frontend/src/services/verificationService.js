/**
 * Verification Service — the caller's opt-in Aadhaar "Verified" badge.
 *
 * `GET /me/verification/aadhaar` · `POST /me/verification/aadhaar`.
 *
 * ## Why this domain needed a context, not just a service
 *
 * Like the plan, the badge is a question the app asks **during render**, not one a component can
 * casually await. `isAadhaarVerified()` was a synchronous localStorage read in seven places — a
 * profile ribbon, the dashboard, the flatmate supply hook, two verify nudges, the owner-overview
 * panel and the contact modal — plus the tenant-profile mirror that also wants the masked digits and
 * the timestamp. Against an API each of those is a network call; the naive conversion (an `await`
 * per reader) draws one screen with seven identical requests whose answers drift.
 *
 * So the badge is fetched once on sign-in and held in `context/VerificationContext.jsx`, and every
 * reader asks `useVerification()` from memory. Same shape as `PlanContext`/`SavedContext`.
 *
 * ## A badge, never a wall (ADR-019)
 *
 * Nothing on the client is gated on this. `useVerification().verified` decides whether to *show* a
 * badge or a nudge — never whether an action is allowed. The one place identity has teeth is
 * server-side, in the contact gate, when an owner opts into "verified contacts only"; that lives in
 * the backend and is untouched by this seam. Migrating these reads is therefore low blast-radius: the
 * worst a wrong answer does is show or hide a nudge.
 *
 * ## Starting does not grant, live
 *
 * `startAadhaar()` is the whole reason the write went through the seam too. The mock grants the badge
 * at once (the demo has no consent page). The server does not: `POST` answers 202 with a DigiLocker
 * consent url and the badge is granted only when the signed webhook lands — nothing the browser does
 * can force it. So the two providers return different-shaped results and the caller must branch:
 *
 *   mock →  { verified: true,  perk }              (badge granted, growth perk lit)
 *   http →  { pending: true,  verificationUrl }    (redirect the browser, then wait on the webhook)
 *
 * `VerificationContext.startVerification` re-reads after a mock grant so the badge shows at once, and
 * hands the http handle back so the modal can redirect. The growth perk has no server counterpart and
 * stays mock-only (see providers/mock/verificationProvider.js).
 */
import { createProvider } from './config.js';

const provider = createProvider('verification');

/** The caller's badge view model: `{ verified, status, source, maskedAadhaar, mobileMatch,
    verifiedAt, aadhaarMobile }`. Signed-out / never-attempted reads as the `none` tier. */
export const getAadhaarStatus = () => provider().getAadhaarStatus();

/** Begin (or retry) DigiLocker verification. Mock → granted badge + perk; http → pending handle. */
export const startAadhaar = (details) => provider().startAadhaar(details);
