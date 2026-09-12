package com.draazy.api.engagement.flatmate;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * Contract schema {@code FlatmateSeekerPostCreate}. Also serves the PATCH, which the contract
 * declares with the same body.
 *
 * <p>Every bound here exists because this is an authenticated write that renders on an
 * <strong>anonymous</strong> page. Bounds are the cheapest half of moderating that: they cannot
 * tell whether a note is abusive, but they can stop the free-text fields being used as a payload,
 * a defacement or a place to park a phone number in 4 KB of padding.
 *
 * <p>The enum-valued fields ({@code gender}, {@code flatPref}, {@code roomPref}) are validated in
 * the service against {@link FlatmateVocabulary} rather than by a {@code @Pattern} here, so a bad
 * value produces a message naming the field and listing what was expected.
 *
 * @param age nullable — optional on the form. The floor is 18 because a minor advertising
 *            themselves to strangers looking for a flat is not something to accept politely.
 */
public record FlatmateSeekerPostCreateRequest(
        @NotBlank @Size(min = 2, max = 80) String name,
        String gender,
        @Min(18) @Max(120) Integer age,
        @Size(max = 80) String occupation,
        @NotNull @Min(1) @Max(10_000_000) Long budget,
        @NotEmpty @Size(max = 10) List<@NotBlank @Size(max = 80) String> localities,
        @Size(max = 40) String moveIn,
        String flatPref,
        String roomPref,
        @Size(max = 20) List<@NotBlank @Size(max = 40) String> tags,
        @Size(max = 600) String note,
        Boolean verifiedContactOnly) {
}
