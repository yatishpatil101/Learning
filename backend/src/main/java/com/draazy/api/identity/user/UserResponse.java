package com.draazy.api.identity.user;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;

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
 * @param listingsCount      how many listings this account has <em>ever</em> posted, including the
 *                           rejected and the archived — the owner-vs-seeker persona, not the live
 *                           inventory. The count of listings a visitor can actually open is a
 *                           different number and is counted at the point of use; see
 *                           {@link User#recordListingPosted()} for why the two are kept apart
 * @param joinedAt           first sign-up time
 * @param createdAt          row creation time
 * @param permissions        the caller's own resolved back-office atoms (`module:action`), and
 *                           <strong>only</strong> on {@code GET /auth/me}, where
 *                           {@code MeController} fills them in. Null — and so absent from the JSON,
 *                           see {@code NON_NULL} below — everywhere else this record is served,
 *                           because every other route describes somebody other than the caller.
 *                           Empty is a different answer from absent: it means a back-office account
 *                           scoped to nothing, which is a real state a console must be able to show
 * @param flagged            the internal review marker (V77), and <strong>only</strong> on the
 *                           back-office user routes, where {@code UserAdminService} fills it in.
 *                           Boxed rather than primitive so that "nobody asked" is representable and
 *                           absent from the JSON: a plain {@code boolean} would put
 *                           {@code "flagged": false} on {@code GET /auth/me}, telling the account
 *                           holder about a moderation facility that is none of their business and
 *                           inviting a client to render it. A flag is a note between colleagues
 * @param flagReason         what was noticed. Present exactly when {@code flagged} is true, because
 *                           a flag without one is a smear the next moderator cannot act on; the V77
 *                           CHECK enforces the same pairing in the database
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
        Instant createdAt,
        List<String> permissions,
        Boolean flagged,
        String flagReason) {
}
