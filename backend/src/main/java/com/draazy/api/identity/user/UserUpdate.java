package com.draazy.api.identity.user;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

// Deliberately narrow: identity/trust fields are server-owned and not accepted here.
public record UserUpdate(

        // Server-side because the column has no length; must match the frontend isValidName.
        // Any script's letters (\p{M} keeps Devanagari vowel signs) plus space . ' -
        @Size(min = 2, max = 80) @Pattern(regexp = "\\p{L}[\\p{L}\\p{M} .'-]*") String name,
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
