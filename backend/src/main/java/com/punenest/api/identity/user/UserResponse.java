package com.punenest.api.identity.user;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/**
 * Public projection of a {@link User} (contract {@code User} schema). This is the entity↔wire
 * boundary for the identity slice: controllers never serialize the JPA entity directly, so internal
 * columns (notably {@code password_hash} and the soft-delete triplet) can never leak, and the JSON
 * stays pinned to the contract regardless of entity changes.
 *
 * <p>{@code aadhaarVerified} is exposed as the contract defines it but is only ever a trust
 * <em>signal</em>, never a gate (ADR-019).
 *
 * <p>Populated by {@code UserMapper} (MapStruct) at the edge; the record itself carries no mapping
 * logic so the wire shape stays a pure contract declaration.
 *
 * @param id                 opaque user id
 * @param mobile             10-digit mobile (natural identity)
 * @param team               staff ops team, else null
 * @param verified           opt-in identity "Verified" badge (L2)
 * @param city               home city
 * @param mobileVerified     L1 trust floor — the participation gate
 * @param aadhaarVerified    DigiLocker badge (alias of {@code verified}) — signal, not a gate
 * @param verifiedContactOnly owner preference: accept contact only from L2-verified users
 * @param hideNumber         owner preference: stay masked even after approving a contact request
 *                           (D5). Read back here so the profile screen can render the toggle it
 *                           just set; the reveal decision itself is made server-side in
 *                           {@code ContactGateService}, never by the client reading this
 * @param listingsCount      active listings (owners)
 * @param joinedAt           first sign-up time
 * @param createdAt          row creation time
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record UserResponse(
        String id,
        String name,
        String mobile,
        String email,
        String role,
        String team,
        String status,
        boolean verified,
        String city,
        boolean mobileVerified,
        boolean aadhaarVerified,
        boolean verifiedContactOnly,
        boolean hideNumber,
        int listingsCount,
        Instant joinedAt,
        Instant lastActive,
        Instant createdAt) {
}
