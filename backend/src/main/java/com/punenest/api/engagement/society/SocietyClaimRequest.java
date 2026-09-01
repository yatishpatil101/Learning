package com.punenest.api.engagement.society;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * A committee asking to administer its society page (contract {@code SocietyClaimRequest}).
 *
 * <p>{@code role} is free text and not an enum. Committee titles in Pune are not a closed set —
 * secretary, chairman, treasurer, managing committee member, "building in-charge" — and a dropdown
 * that omits the caller's actual title teaches them to pick the nearest wrong one, which is worse
 * for the ops reviewer than the free text would have been.
 */
public record SocietyClaimRequest(
        @NotBlank @Size(max = 120) String name,
        @Size(max = 80) String role,
        @Email @Size(max = 160) String email,
        @Size(max = 500) String note) {
}
