package com.draazy.api.finance.tenancy;

import java.time.LocalDate;

/**
 * One tenancy as the wire sees it (contract {@code Tenancy}).
 *
 * <p>Both {@link #tenant} and {@link #owner} are {@link Party} objects carrying a mobile, so this
 * shape is trust-shaped end to end and {@link TenancyMapper} is hand-written (§8.1).
 *
 * <p><strong>Lean by design.</strong> The mock's tenancy record also carries {@code title},
 * {@code address}, {@code locality}, {@code bhk} and {@code image}; those are denormalised copies
 * of the listing that the frontend re-joins from {@code propertyId}, exactly as it already does for
 * visits. Duplicating them here would let a renamed listing disagree with its own tenancy.
 *
 * @param propertyId the let listing
 * @param tenant     the occupant; mobile revealed (the two parties are in a signed agreement)
 * @param owner      the landlord; mobile revealed for the same reason
 * @param rent       monthly rent, whole INR
 * @param deposit    security deposit, whole INR
 * @param startDate  when the agreement begins
 * @param endDate    when it is due to end, or when it ended once terminal
 * @param status     one of {@link TenancyStatuses}
 */
public record TenancyDto(
        String id,
        String propertyId,
        Party tenant,
        Party owner,
        Long rent,
        Long deposit,
        LocalDate startDate,
        LocalDate endDate,
        String status) {

    /**
     * A participant in the tenancy (contract {@code Party}).
     *
     * @param id     user id — always present; a tenancy is only ever between two registered users
     * @param mobile revealed to the counterparty, masked to anyone else
     * @param role   {@code tenant} or {@code owner}
     */
    public record Party(String id, String name, String mobile, String role) {
    }
}
