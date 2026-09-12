package com.draazy.api.leads.photos;

/**
 * The result of asking for more photos.
 *
 * <p><strong>Why a flag rather than a status code.</strong> The buyer-facing difference between "sent"
 * and "you already asked" is a different toast, so the client has to branch on it. Expressing that as
 * {@code 201} vs {@code 200} would push the distinction into the transport, where the fetch wrapper
 * discards it — every provider in {@code services/providers/http} reads the parsed body and nothing
 * else. A field survives the seam; a status code does not.
 *
 * <p>Not a {@code 409} either, for the same reason the contact gate does not raise one: a repeat tap
 * is a no-op, not an error. Returning an error envelope for it would make the client's happy path run
 * through its failure handler, and any generic "something went wrong" toast would then fire on a
 * request that worked perfectly the first time.
 *
 * @param created {@code true} when this call inserted the row, {@code false} when it found one the
 *                caller had already made
 * @param request the row either way — a repeat returns the original, with its original
 *                {@code createdAt}, so the client can say when they first asked
 */
public record PhotoRequestCreateResponse(boolean created, PhotoRequestResponse request) {
}
