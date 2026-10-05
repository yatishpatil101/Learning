package com.draazy.api.identity.auth;

import jakarta.validation.constraints.NotBlank;

/** Body for {@code POST /auth/staff-login/enrol} (contract {@code StaffEnrolRequest}). */
public record StaffEnrolRequest(@NotBlank String challenge) {
}
