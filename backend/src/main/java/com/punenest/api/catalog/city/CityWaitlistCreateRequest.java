package com.punenest.api.catalog.city;

import com.punenest.api.common.validation.IndianMobile;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Request to join a city's waitlist (contract {@code CityWaitlistRequest}).
 *
 * <p><strong>No {@code name} field, and that is deliberate.</strong> The frontend form collects one;
 * the contract does not carry it and the table has no column for it. A waitlist needs a way to reach
 * you and a city to reach you about — a name is personal data with no purpose here, and the cheapest
 * way to protect data is not to collect it.
 *
 * @param mobile the contact number, Indian mobile format — the same pattern the contract's
 *               {@code Mobile} schema and the column's CHECK constraint both use
 * @param city   free text: the city being asked for, which by definition is not one we serve, so it
 *               cannot be constrained to the {@code cities} table. Length-capped because an
 *               unauthenticated endpoint must not accept an unbounded string
 * @param email  optional second contact
 */
public record CityWaitlistCreateRequest(
        @NotBlank
        @IndianMobile String mobile,

        @NotBlank @Size(max = 120) String city,

        @Email @Size(max = 254) String email) {
}
