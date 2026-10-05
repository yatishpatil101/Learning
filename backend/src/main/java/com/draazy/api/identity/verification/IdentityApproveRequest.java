package com.draazy.api.identity.verification;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

public record IdentityApproveRequest(
        @NotBlank @Size(max = 40) String number,
        @NotBlank @Size(min = 2, max = 160) String name,
        LocalDate dob,
        Integer birthYear,
        Boolean poseConfirmed,
        Boolean numberOverride) {

    public IdentityApproveRequest(String number, String name, LocalDate dob, Integer birthYear) {
        this(number, name, dob, birthYear, null, null);
    }
}
