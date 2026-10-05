package com.draazy.api.identity.user;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

// Deliberately narrow: identity/trust fields are server-owned and not accepted here.
public record UserUpdate(

        // Server-side because the sign-in path collects name and the column has no length.
        @Size(min = 2, max = 80) @Pattern(regexp = ".*\\S.*") String name,
        @Email String email,
        String avatar,
        String city,
        Boolean hideNumber,
        Boolean verifiedContactOnly,
        Boolean shareActivityStatus,
        Boolean shareReadReceipts) {

        public UserUpdate {
                if (name != null) {
                        name = name.strip();
                }
        }
}
