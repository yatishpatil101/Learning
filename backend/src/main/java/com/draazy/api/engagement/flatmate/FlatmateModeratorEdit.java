package com.draazy.api.engagement.flatmate;

import static com.draazy.api.engagement.flatmate.FlatmateVocabulary.NO_CONTACT;

import com.draazy.api.catalog.listing.NoContactDetails;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

/** A moderator's correction to a post's core fields. A null field is left as it is; {@code rent}
 * is a room's share, a group's rent and a seeker's budget. */
public record FlatmateModeratorEdit(
        @Size(max = 120) @NoContactDetails(message = NO_CONTACT) String title,
        @Size(max = 600) @NoContactDetails(message = NO_CONTACT) String note,
        @Min(1) @Max(10_000_000) Long rent,
        @Min(0) @Max(10_000_000) Long deposit,
        @Size(min = 1, max = 10) List<@NotBlank @Size(max = 80) String> localities,
        LocalDate moveIn) {
}
