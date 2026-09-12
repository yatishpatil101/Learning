package com.draazy.api.finance.tenancy;

import java.time.Instant;
import java.time.LocalDate;

/**
 * One tenancy declaration as the wire sees it (contract {@code TenancyDeclaration}).
 *
 * <p><strong>A name, never a mobile.</strong> The owner needs enough to recognise the claimant and
 * nothing more; a number here would be a contact reveal minted by the claimant simply asserting a
 * relationship, which is precisely the gate the platform's contact rules exist to hold. Same rule as
 * {@code FlatmateModerationQueueDto}.
 *
 * <p>{@link #livedFrom} and {@link #livedTo} are the claimant's own account of when, and are shown
 * to the owner as context for the decision. Nothing else reads them — they are not evidence, they
 * are what the owner is being asked to recognise.
 *
 * @param propertyId    the listing the stay is claimed on
 * @param declarantId   the claimant; the caller uses it to find their own row in the owner's list
 * @param declarantName the claimant's display name
 * @param livedFrom     claimed start of the stay, or null
 * @param livedTo       claimed end of the stay, or null
 * @param status        one of {@link TenancyDeclarationStatuses}
 * @param decidedAt     when the owner last answered, or null while pending
 */
public record TenancyDeclarationDto(
        String id,
        String propertyId,
        String declarantId,
        String declarantName,
        LocalDate livedFrom,
        LocalDate livedTo,
        String status,
        Instant decidedAt) {
}
