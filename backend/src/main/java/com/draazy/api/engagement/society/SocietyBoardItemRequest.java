package com.draazy.api.engagement.society;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalTime;

/**
 * Post a notice or an event.
 *
 * <p>{@code eventDate} is not {@code @NotNull} here even though an event must have one: the rule is
 * conditional on {@code kind}, and a bean-validation annotation cannot express that without a class
 * constraint whose message would name the wrong field. The service refuses it with a sentence that
 * says which field and why, and {@code ck_society_board_event_has_date} is the backstop.
 *
 * <p>{@code eventTime} stays optional for an event. "Sometime on the 14th" is how most society
 * notices are actually written and requiring a time would make committees invent one.
 */
public record SocietyBoardItemRequest(
        @NotBlank @Size(max = 16) String kind,
        @NotBlank @Size(max = 120) String title,
        @Size(max = 800) String body,
        @Size(max = 40) String category,
        LocalDate eventDate,
        LocalTime eventTime) {
}
