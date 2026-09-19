/**
 * Property verification — the owner↔ops case file behind a listing's approval. Listing approval,
 * documentary ownership and identity KYC are three separate decisions; identity lives elsewhere.
 */
import { createProvider } from './config.js';
import { isInternal, readUser } from '../lib/auth.js';

const provider = createProvider('propertyReview');

/** Participant-or-staff case file; `missingKinds` is the server's ownership gate. */
export async function getOwnershipVerification(propertyId) {
  return (await provider()).getOwnershipVerification(propertyId);
}

/** Staff with properties:write only. Raw vault DTOs carry short-lived signed `url` values. */
export async function listOwnershipDocuments(propertyId) {
  return (await provider()).listOwnershipDocuments(propertyId);
}

/** Record { docType, documentId, issuedOn, subjectName }; this does not grant a badge. */
export async function recordOwnershipEvidence(propertyId, evidence) {
  return (await provider()).recordOwnershipEvidence(propertyId, evidence);
}

/** A separate staff decision; the server refuses incomplete evidence and self-verification. */
export async function verifyOwnership(propertyId) {
  return (await provider()).verifyOwnership(propertyId);
}

/** Withdraw the badge with a required reason, retaining the evidence history. */
export async function revokeOwnershipVerification(propertyId, reason) {
  return (await provider()).revokeOwnershipVerification(propertyId, reason);
}

/** The case file, or `null` if this listing has never been submitted. */
export async function getPropertyReview(propertyId) {
  return (await provider()).getPropertyReview(propertyId);
}

/** Open the case file, or return the existing one. Idempotent — safe to call on modal open. */
export async function startPropertyReview(propertyId) {
  return (await provider()).startPropertyReview(propertyId);
}

/** Post to the thread. Returns the updated case file, not just the new message. */
export async function addPropertyReviewMessage(propertyId, body, clarificationRequested) {
  return (await provider()).addPropertyReviewMessage(propertyId, body, clarificationRequested);
}

/** Mark the *other* side's messages read. Which side that is comes from the session. */
export async function markPropertyReviewRead(propertyId) {
  return (await provider()).markPropertyReviewRead(propertyId);
}

/**
 * @param item the exact checklist text, e.g. `'Electricity bill'`; an unknown one is a 404
 * @param pass `true` to tick, `false` to untick — one line per call, to avoid last-write-wins races
 */
export async function setPropertyReviewChecklistItem(propertyId, item, pass) {
  return (await provider()).setPropertyReviewChecklistItem(propertyId, item, pass);
}

/**
 * @param decision `approve` or `reject`; one call also moves the listing's public status
 * @param note     free text; on a rejection this is the reason the owner is shown
 */
export async function decidePropertyReview(propertyId, decision, note) {
  return (await provider()).decidePropertyReview(propertyId, decision, note);
}

/** The staff queue — every case file, newest touched first. Paged; there is no server-side filter. */
export async function listPropertyReviewQueue(params) {
  return (await provider()).listPropertyReviewQueue(params);
}

/**
 * Owner queue, newest touched first; avoids per-card reads for status and unread counts.
 * Rows carry no listing detail — join the screen's listings by `propertyId`.
 */
export async function listMyPropertyReviews(params) {
  return (await provider()).listMyPropertyReviews(params);
}

/**
 * Messages from the other side the reader has not seen, derived from the loaded thread. The
 * reader's side comes from the session, never a caller-supplied role that could gate authorization.
 */
export function unreadFrom(caseFile) {
  const theirs = isInternal(readUser()) ? 'owner' : 'ops';
  const messages = Array.isArray(caseFile?.messages) ? caseFile.messages : [];
  return messages.filter((m) => m.from === theirs && !m.read).length;
}
