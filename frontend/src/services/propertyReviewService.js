import { createProvider } from './config.js';
import { isInternal, readUser } from '../lib/auth.js';

const provider = createProvider('propertyReview');

/** Participant-or-staff case file; `missingKinds` is the server's ownership gate. */
export async function getOwnershipVerification(propertyId) {
  return (await provider()).getOwnershipVerification(propertyId);
}

/** Staff with property verification access only. Summaries carry no file URL; mint one per open. */
export async function listOwnershipDocuments(propertyId) {
  return (await provider()).listOwnershipDocuments(propertyId);
}

/** Signed, short-lived URL for one vault file, minted when the reviewer opens it. */
export async function getOwnershipDocumentUrl(propertyId, docId) {
  return (await provider()).getOwnershipDocumentUrl(propertyId, docId);
}

/** Record { docType, documentId, issuedAt, subjectName }; this does not grant a badge. */
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

/** Owner only: ask for the badge once the vault holds the papers. Idempotent while open. */
export async function requestOwnershipVerification(propertyId) {
  return (await provider()).requestOwnershipVerification(propertyId);
}

/** Staff: answer an open badge request without granting it; the owner is told `reason`. */
export async function declineOwnershipVerification(propertyId, reason) {
  return (await provider()).declineOwnershipVerification(propertyId, reason);
}

/** The case file, or `null` if this listing has never been submitted. */
export async function getPropertyReview(propertyId) {
  return (await provider()).getPropertyReview(propertyId);
}

/** Open the case file, or return the existing one. Idempotent — safe to call on modal open. */
export async function startPropertyReview(propertyId, options) {
  return (await provider()).startPropertyReview(propertyId, options);
}

/** Post to the thread. Returns the updated case file, not just the new message. */
export async function addPropertyReviewMessage(propertyId, body, clarificationRequested) {
  return (await provider()).addPropertyReviewMessage(propertyId, body, clarificationRequested);
}

/** Mark the *other* side's messages read. Which side that is comes from the session. */
export async function markPropertyReviewRead(propertyId) {
  return (await provider()).markPropertyReviewRead(propertyId);
}

export async function setPropertyReviewChecklistItem(propertyId, item, pass) {
  return (await provider()).setPropertyReviewChecklistItem(propertyId, item, pass);
}

export async function decidePropertyReview(propertyId, decision, options) {
  return (await provider()).decidePropertyReview(propertyId, decision, options);
}

export async function requestPropertyReviewOverride(propertyId, reason) {
  return (await provider()).requestPropertyReviewOverride(propertyId, reason);
}

export async function approvePropertyReviewOverride(propertyId, requestId, note) {
  return (await provider()).approvePropertyReviewOverride(propertyId, requestId, note);
}

export async function propertyReviewOverrideAvailable() {
  return Boolean((await provider()).OVERRIDE_REQUESTS_ENABLED);
}

export async function listMyPropertyReviews(params) {
  return (await provider()).listMyPropertyReviews(params);
}

/** The reader's side comes from the session, never a caller-supplied role that could gate authorization. */
export function unreadFrom(caseFile) {
  const theirs = isInternal(readUser()) ? 'owner' : 'ops';
  const messages = Array.isArray(caseFile?.messages) ? caseFile.messages : [];
  return messages.filter((m) => m.from === theirs && !m.read).length;
}
