package com.punenest.api.common.trust;

import java.util.UUID;

/**
 * Answers the one question the reviews feature must ask of the transaction contexts: has this person
 * actually experienced this listing, and how?
 *
 * <p><strong>Why a port in the shared kernel.</strong> The evidence lives in two contexts that both
 * sit <em>above</em> {@code engagement} in the layering enforced by
 * {@code ArchitectureBoundaryTest}: visits belong to {@code deals}, tenancies to {@code finance}. A
 * direct import would be an upward reference and a cycle — the exact failure that test exists to
 * catch. Declaring the interface here (the kernel imports no feature) and implementing it in
 * {@code deals} inverts the arrow, precisely as {@link ContactGate} did for the contact reveal in
 * slice 3.
 *
 * <p>The tempting shortcut — a native query from {@code engagement} straight at the {@code visits}
 * and {@code tenancies} tables — would slip past that test, because the test matches package
 * references and a SQL string names none. It would also be strictly worse than the import it evades:
 * another context's <em>tables</em> are more private than its API, and coupling to them means any
 * future change to how a visit is recorded silently breaks reviews with nothing failing at compile
 * time. Evading a guardrail is not the same as satisfying it.
 *
 * <p>Ids only, no entities — the kernel must not learn a feature's model.
 */
public interface PropertyExperience {

    /**
     * The strongest standing this user can claim on this listing.
     *
     * <p>Tenancy outranks a visit, and tenancy is deliberately <em>not</em> filtered by status: a
     * person who rented a flat for two years and moved out last month is exactly the reviewer a
     * prospective tenant most wants to hear from. Ending a tenancy ends a commercial relationship,
     * not the lived experience the review is reporting.
     *
     * @param userId     the authenticated caller
     * @param propertyId the listing they are trying to review
     * @return {@link ReviewerStanding#TENANT}, {@link ReviewerStanding#VISITED}, or
     *         {@link ReviewerStanding#NONE} when there is no evidence either way
     */
    ReviewerStanding standingOf(UUID userId, UUID propertyId);
}
