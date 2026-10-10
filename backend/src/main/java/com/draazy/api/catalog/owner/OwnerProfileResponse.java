package com.draazy.api.catalog.owner;

/** The public seller card, a ceiling on what a stranger is told: no email, role, status or {@code lastActive}
 * (a presence indicator); the mobile is masked because a profile has no contact gate to ask. */
public record OwnerProfileResponse(
        String name,
        String mobile,
        boolean verified,
        String city,
        Integer memberSince,
        long listingCount) {
}
