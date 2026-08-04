package com.punenest.api.finance.tenancy;

import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * The write shape for {@code PUT /me/tenant-profile} (contract {@code TenantProfileUpdate}).
 *
 * <p><strong>{@code score}, {@code verified} and {@code mobile} are absent, not ignored</strong>
 * (spec fix S17). A tenant who could send {@code score: 100} would be setting the exact number
 * owners use to decide whether to let them into a flat, and a writable {@code mobile} would let a
 * profile be filed against somebody else's number. Leaving them out of the type means a client
 * author discovers the rule from the contract rather than from an unexplained no-op.
 *
 * <p><strong>Replace, not merge.</strong> {@code PUT} replaces: an absent field clears the stored
 * value. That matches the only writer — the profile form posts its whole state on every save — and
 * it is the semantics the verb promises. A tenant who deletes their prior-landlord reference
 * expects it gone, and a merging PUT would silently keep it.
 *
 * <p>No {@code @NotBlank} anywhere: the profile is progressive, and the score already rewards
 * completeness. Rejecting a half-filled profile would stop a tenant saving their progress.
 *
 * @param occupants must be one of {@link OccupantTypes}; validated in
 *                  {@link TenantProfileService} rather than by an annotation, so the rejection
 *                  names the permitted values
 */
public record TenantProfileUpdateRequest(
        @Size(max = 120) String name,
        @Size(max = 120) String occupation,
        @PositiveOrZero Long income,
        String occupants,
        LocalDate moveIn,
        @Size(max = 200) String priorLandlord,
        @Size(max = 2000) String about) {
}
