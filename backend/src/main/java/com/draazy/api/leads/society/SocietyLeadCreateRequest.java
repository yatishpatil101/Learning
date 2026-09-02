package com.draazy.api.leads.society;

import com.draazy.api.common.validation.IndianMobile;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Contract schema {@code SocietyLeadCreate} — the public B2B enquiry form.
 *
 * <p>Bounds are on every field because this is the platform's only unauthenticated write that
 * stores free text. {@code units} is bounded to match the V24 check constraint, so a bad value is
 * a 422 naming the field rather than a 500 from the database.
 */
public record SocietyLeadCreateRequest(
        @NotBlank @Size(max = 160) String societyName,
        @NotBlank @Size(max = 120) String contactName,
        @NotBlank
        @IndianMobile
        String mobile,
        @Min(1) @Max(20_000) Integer units,
        String interest) {
}
