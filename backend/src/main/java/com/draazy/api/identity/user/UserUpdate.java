package com.draazy.api.identity.user;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Body for {@code PATCH /auth/me}. Deliberately narrow — identity/trust fields are server-owned and
 * are not accepted here, and the booleans are boxed so "unmentioned" stays distinct from "turn off".
 */
public record UserUpdate(
        /* Bounded here and not only in the browser, because the name is collected on the sign-in path
           itself and the column has no length. @Pattern is not redundant with @Size: @Size counts
           characters, so a blank-only name would pass and could never satisfy the name step. */
        @Size(min = 2, max = 80) @Pattern(regexp = ".*\\S.*") String name,
        @Email String email,
        String avatar,
        String city,
        Boolean hideNumber,
        Boolean verifiedContactOnly) {

        public UserUpdate {
                if (name != null) {
                        name = name.strip();
                }
        }
}
