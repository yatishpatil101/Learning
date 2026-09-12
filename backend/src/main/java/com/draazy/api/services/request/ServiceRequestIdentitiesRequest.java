package com.draazy.api.services.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * Contract schema {@code ServiceRequestIdentities} — the body of
 * {@code PUT /service-requests/{id}/identities} (D151).
 *
 * <p><strong>A whole-set replace, not an append.</strong> The wizard holds every party in one form
 * and resubmits all of them when the customer fixes a typo. Appending would leave the mistyped
 * number in the table under a shifted index, and the desk would have two candidate Aadhaars for one
 * tenant with nothing to choose between them.
 *
 * <p><strong>Formats are validated here rather than in the service</strong> so a malformed number is
 * a 422 naming the field, which is the platform's convention for body validation, and so the value
 * itself never reaches a log line or an exception message. The patterns match
 * {@code identity.kyc.OwnerKycUpdateRequest} byte for byte; they are not hoisted into
 * {@code common.validation.Formats} because that file's own admission criteria require two bounded
 * contexts and this is the second <em>use</em> but still the same shape — hoisting is a follow-up
 * with its own name, not a side effect of this one.
 */
public record ServiceRequestIdentitiesRequest(
        /*
           At least one party, and a ceiling. Twelve is well past a real Leave & License (an owner
           and a handful of tenants) and short of anything worth storing in bulk; the cap is here
           because this endpoint writes rows and nothing else throttles it (D2).
        */
        @NotEmpty(message = "record at least one party")
        @Size(max = 12, message = "at most 12 parties")
        List<@Valid Party> parties) {

    /**
     * One named party and the numbers the agreement will print for them.
     *
     * <p>Both numbers are optional individually — a tenant may genuinely have no PAN — but a party
     * carrying neither says nothing, so {@link #hasANumber()} refuses it. Silently dropping such a
     * party would leave the desk short of a number it has no way to know it should have asked for.
     */
    public record Party(
            @NotNull
            @Pattern(regexp = "^(owner|tenant)$", message = "must be owner or tenant")
            String partyRole,

            @PositiveOrZero(message = "must not be negative")
            int partyIndex,

            @Size(max = 120, message = "must be 120 characters or fewer")
            String partyName,

            @Pattern(regexp = "^$|^[A-Za-z]{5}[0-9]{4}[A-Za-z]$", message = "must be a valid PAN")
            String pan,

            @Pattern(regexp = "^$|^[0-9]{12}$", message = "must be a 12-digit Aadhaar number")
            String aadhaar) {

        /**
         * Refuses a party with no number at all.
         *
         * <p>An {@code @AssertTrue} rather than a service check so it lands in the same 422
         * {@code fields[]} array as a malformed PAN — "this party is incomplete" and "this PAN is
         * wrong" are the same kind of mistake to the person filling the form, and answering them
         * with two different status codes would make the wizard handle them twice.
         */
        @AssertTrue(message = "record a PAN or an Aadhaar number for each party")
        public boolean hasANumber() {
            return isPresent(pan) || isPresent(aadhaar);
        }

        /** The PAN as it will be stored — upper-cased, or null when the field was left empty. */
        String normalisedPan() {
            return isPresent(pan) ? pan.trim().toUpperCase(java.util.Locale.ROOT) : null;
        }

        /** The Aadhaar as it will be stored, or null when the field was left empty. */
        String normalisedAadhaar() {
            return isPresent(aadhaar) ? aadhaar.trim() : null;
        }

        /** The name as it will be stored, or null. */
        String normalisedName() {
            return isPresent(partyName) ? partyName.trim() : null;
        }

        private static boolean isPresent(String value) {
            return value != null && !value.isBlank();
        }
    }
}
