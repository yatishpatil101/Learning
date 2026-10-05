/** This is the widest gap between what the page does and what the contract carries, so this module is where the seam
 * is drawn honestly rather than overclaimed. */
import { createProvider } from './config.js';

const provider = createProvider('serviceRequest');

export const listServiceRequests = async (typeFilter) => (await provider()).listServiceRequests(typeFilter);

/** One request with its thread and documents, or null if it is not the caller's. */
export const getServiceRequest = async (id) => (await provider()).getServiceRequest(id);

/** That is the reason it is a separate export rather than an option on `listServiceRequests` — a flag on one function
 * is a flag somebody sets on a consumer surface, and the page it renders would look correct. */
export const listServiceRequestQueue = async (opts) => (await provider()).listServiceRequestQueue(opts);

/** Tab counts for one desk (`rental`, `legal`, …): `{ toPickUp, mine, inProgress, withCustomer, closed, overdue }`. */
export const getServiceRequestQueueSummary = async (team) => (await provider()).getServiceRequestQueueSummary(team);

export const takeServiceRequest = async (id) => (await provider()).takeServiceRequest(id);

/** Share the next version of a draft with the customer. Staff/admin only. */
export const shareServiceRequestDraft = async (id, payload) =>
  (await provider()).shareServiceRequestDraft(id, payload);

/** Upload the registered final copy after customer approval. Staff/admin only. */
export const uploadServiceRequestFinalDoc = async (id, file, registration) =>
  (await provider()).uploadServiceRequestFinalDoc(id, file, registration);

/** Cancel from the desk; `reason` is required and reaches the customer. */
export const cancelServiceRequestAsOps = async (id, reason) =>
  (await provider()).cancelServiceRequestAsOps(id, reason);

/* Identity data must stay in view state only; the route cannot police browser persistence. */
export const readServiceRequestIdentities = async (id) => (await provider()).readServiceRequestIdentities(id);

/** A desk operation that marked paperwork verified would be inventing a second source of truth for the same fact. */
export const readServiceRequestChecklist = async (id) => (await provider()).readServiceRequestChecklist(id);

export const reviewServiceRequestDocument = async (id, category, review) =>
  (await provider()).reviewServiceRequestDocument(id, category, review);

/** The registration check's rows (staff/admin; not to a side of the request). */
export const listServiceRequestRentAgreements = async (id) =>
  (await provider()).listServiceRequestRentAgreements(id);

/** Overlapping rent agreements on the same flat (staff/admin; not to a side of the request). */
export const listServiceRequestOverlaps = async (id) =>
  (await provider()).listServiceRequestOverlaps(id);

export const proposeServiceRequestAmendment = async (id, amendment) =>
  (await provider()).proposeServiceRequestAmendment(id, amendment);

/** The requester accepts re-priced terms; resolves with `paymentSessionId` when a difference is due. */
export const acceptServiceRequestAmendment = async (id, amendmentId) =>
  (await provider()).acceptServiceRequestAmendment(id, amendmentId);

export const withdrawServiceRequestAmendment = async (id, amendmentId) =>
  (await provider()).withdrawServiceRequestAmendment(id, amendmentId);

export const getServiceRequestRefunds = async (id) => (await provider()).getServiceRequestRefunds(id);

/** The holder asks; a different operator approves before any money moves. Resolves to the summary. */
export const requestServiceRequestRefund = async (id, refund) =>
  (await provider()).requestServiceRequestRefund(id, refund);

export const decideServiceRequestRefund = async (id, refundId, decision, note) =>
  (await provider()).decideServiceRequestRefund(id, refundId, decision, note);

/** Staff records that the owner confirmed tenant information was submitted to the police. */
export const confirmServiceRequestPoliceIntimation = async (id, payload) =>
  (await provider()).confirmServiceRequestPoliceIntimation(id, payload);

/** Second-operator verdict on one tenancy row: `registered` or `expired`. */
export const verifyRentAgreement = async (agreementId, status) =>
  (await provider()).verifyRentAgreement(agreementId, status);

/** Create a request from a service form. Structured `details` round-trip to the server. */
export const createServiceRequest = async (data) => (await provider()).createServiceRequest(data);

/** Create a deferred co-fill request and invite the counterparty (rent-agreement only). */
export const createCoFillServiceRequest = async ({ request, role, mobile }) =>
  (await provider()).createCoFillServiceRequest({ request, role, mobile });

/** Outstanding co-fill invites addressed to the signed-in account. */
export const listMyServiceRequestInvites = async () =>
  (await provider()).listMyServiceRequestInvites();

/** Accept or decline one co-fill invite (`decision`: `accept|decline`). */
export const decideServiceRequestInvite = async (partyId, decision) =>
  (await provider()).decideServiceRequestInvite(partyId, decision);

/** Accepted invitee submits their half of the request details. */
export const submitServiceRequestPartyDetails = async (id, details) =>
  (await provider()).submitServiceRequestPartyDetails(id, details);

/** Requester opens checkout for a deferred request; a rent agreement names the accepted declaration version. */
export const openServiceRequestCheckout = async (id, declaration) =>
  (await provider()).openServiceRequestCheckout(id, declaration);
export const simulateServiceRequestPayment = async (id, outcome) =>
  (await provider()).simulateServiceRequestPayment(id, outcome);
export const cancelServiceRequest = async (id) =>
  (await provider()).cancelServiceRequest(id);

/** Requester takes back an unanswered co-fill invitation, or clears a declined one, freeing the role. */
export const withdrawServiceRequestParty = async (id, partyId) =>
  (await provider()).withdrawServiceRequestParty(id, partyId);

export const inviteServiceRequestParty = async (id, { role, mobile, partyIndex }) =>
  (await provider()).inviteServiceRequestParty(id, { role, mobile, partyIndex });

/** Upload one document onto a service request. */
export const addServiceRequestDoc = async (id, doc) =>
  (await provider()).addServiceRequestDoc(id, doc);

export const addServiceRequestDocFromVault = async (id, { documentId, category }) =>
  (await provider()).addServiceRequestDocFromVault(id, { documentId, category });

export const recordServiceRequestIdentities = async (id, parties) =>
  (await provider()).recordServiceRequestIdentities(id, parties);

/** Post a customer message onto a request's thread. Resolves to the updated request. */
export const addServiceRequestMessage = async (id, text) =>
  (await provider()).addServiceRequestMessage(id, text);

export const decideServiceRequestDraft = async (id, decision, note) =>
  (await provider()).decideServiceRequestDraft(id, decision, note);

export const approveServiceRequestDraftParty = async (id, partyKey, otp) =>
  (await provider()).approveServiceRequestDraftParty(id, partyKey, otp);

export const checkServiceRequestDraft = async (id, decision, note) =>
  (await provider()).checkServiceRequestDraft(id, decision, note);

/** Record that the caller opened the other side's messages. */
export const markServiceRequestRead = async (id) => (await provider()).markServiceRequestRead(id);

/** Record that the caller opened the shared draft; the server approves only an opened version. */
export const markServiceRequestDraftOpened = async (id) =>
  (await provider()).markServiceRequestDraftOpened(id);
