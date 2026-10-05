package com.draazy.api.services.request;

import com.draazy.api.common.validation.Aadhaar;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

// Replace roles in the body; wizard resubmits owned parties after typo fixes.
// Co-filled tenant rows survive requester resubmits.
public record ServiceRequestIdentitiesRequest(

        // Cap matches wizard parties; this endpoint writes rows and has no other throttle.
        @NotEmpty(message = "record at least one party")
        @Size(max = 12, message = "at most 12 parties")
        List<@Valid Party> parties) {

    @AssertTrue(message = "each party role and index may appear only once")
    public boolean isDistinct() {
        if (parties == null) {
            return true;
        }
        Set<String> slots = new HashSet<>();
        for (Party party : parties) {
            if (party == null) {
                continue;
            }
            if (!slots.add(party.partyRole() + ":" + party.partyIndex())) {
                return false;
            }
        }
        return true;
    }

    @AssertTrue(message = "witness index must be 0 or 1")
    public boolean isWitnessIndexAllowed() {
        return parties == null || parties.stream().filter(party -> party != null && "witness".equals(party.partyRole())).allMatch(party -> party.partyIndex() <= 1);
    }

    @AssertTrue(message = "the same Aadhaar number is recorded for two parties")
    public boolean isAadhaarDistinct() {
        if (parties == null) {
            return true;
        }
        Set<String> aadhaars = new HashSet<>();
        for (Party party : parties) {
            if (party != null && party.normalisedAadhaar() != null
                    && !aadhaars.add(party.normalisedAadhaar())) {
                return false;
            }
        }
        return true;
    }

    @AssertTrue(message = "the same PAN is recorded for two parties")
    public boolean isPanDistinct() {
        if (parties == null) {
            return true;
        }
        Set<String> pans = new HashSet<>();
        for (Party party : parties) {
            if (party != null && party.normalisedPan() != null && !pans.add(party.normalisedPan())) {
                return false;
            }
        }
        return true;
    }

    Set<String> roles() {
        return parties.stream().map(Party::partyRole).collect(Collectors.toSet());
    }

    // A party with neither number says nothing, so reject instead of dropping it.
    public record Party(
            @NotNull
            @Pattern(regexp = "^(owner|tenant|witness)$", message = "must be owner, tenant or witness")
            String partyRole,

            @PositiveOrZero(message = "must not be negative")
            int partyIndex,

            @Size(max = 120, message = "must be 120 characters or fewer")
            String partyName,

            @Pattern(regexp = "^$|^[A-Za-z]{5}[0-9]{4}[A-Za-z]$", message = "must be a valid PAN")
            String pan,

            @Aadhaar
            String aadhaar) {

        // Keep this as validation so incomplete and malformed identity rows share 422 fields[].
        @AssertTrue(message = "record a PAN or an Aadhaar number for each party")
        public boolean hasANumber() {
            return isPresent(pan) || isPresent(aadhaar);
        }

        String normalisedPan() {
            return isPresent(pan) ? pan.trim().toUpperCase(java.util.Locale.ROOT) : null;
        }

        String normalisedAadhaar() {
            return isPresent(aadhaar) ? aadhaar.strip() : null;
        }

        String normalisedName() {
            return isPresent(partyName) ? partyName.trim() : null;
        }

        private static boolean isPresent(String value) {
            return value != null && !value.isBlank();
        }
    }
}
