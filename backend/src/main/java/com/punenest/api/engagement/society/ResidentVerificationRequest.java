package com.punenest.api.engagement.society;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Asking to be recognised as a resident (contract {@code ResidentVerificationRequest}).
 *
 * <p>{@code wing} is optional because plenty of societies are a single building and have none;
 * {@code flat} is not, because a residency without a unit cannot be checked for the uniqueness that
 * the whole feature rests on.
 *
 * <p>{@code relation} is validated in the service against {@link SocietyResidentRelations} rather
 * than by an annotation, so the refusal names the accepted values instead of quoting a regex.
 */
public record ResidentVerificationRequest(
        @Size(max = 16) String wing,
        @NotBlank @Size(max = 16) String flat,
        @Size(max = 16) String relation,
        @Size(max = 500) String note) {
}
