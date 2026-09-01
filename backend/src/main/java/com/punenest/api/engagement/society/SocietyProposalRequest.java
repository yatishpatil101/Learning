package com.punenest.api.engagement.society;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;

/**
 * One request record for all three kinds of proposal.
 *
 * <p>One record rather than three because the endpoint is one endpoint, and a discriminated union
 * expressed as three sibling routes makes the client decide which URL a form posts to before the
 * server has agreed the form is coherent. The shape rules live in the service and in a database
 * check constraint, which is where they can be stated once and enforced for every caller.
 *
 * <p>Only the bounds a value can never legitimately exceed are asserted here. Whether a proposal of
 * this kind is allowed to carry this field at all is not a bean-validation question — a stray
 * {@code inviteUrl} on a detail suggestion is dropped rather than refused, because the composer
 * does not draw that field for that kind and a 422 would point at something the author cannot see.
 *
 * @param kind      {@code details}, {@code whatsapp} or {@code location}
 * @param inviteUrl a {@code https://chat.whatsapp.com/…} link; format checked in the service
 * @param amenities null means "not proposed"; empty means "this society has none"
 */
public record SocietyProposalRequest(
        @NotBlank @Size(max = 16) String kind,

        @Size(max = 120) String builder,
        @Positive Integer buildYear,
        @Positive Integer towers,
        @Positive Integer units,
        @DecimalMin("0.0") @DecimalMax("999.99") BigDecimal maintenancePerSqft,
        @Size(max = 24) List<@Size(max = 60) String> amenities,

        @Size(max = 300) String inviteUrl,

        // A latitude outside ±90 is not a coordinate at all, whatever the city box then says
        // about it. Refused here so the range error names the field rather than arriving as a
        // vaguer "that pin looks outside the city".
        @DecimalMin("-90.0") @DecimalMax("90.0") Double lat,
        @DecimalMin("-180.0") @DecimalMax("180.0") Double lng,
        @Size(max = 300) String placeId,
        @Size(max = 160) String label) {
}
