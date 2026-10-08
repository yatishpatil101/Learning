package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.util.List;
import org.junit.jupiter.api.Test;

class FlatmateRoomNoContactTest {

    private static final Validator VALIDATOR = Validation.buildDefaultValidatorFactory().getValidator();
    private static final String MOBILE = "Call 98765 43210";

    @Test
    void roomFreeTextRefusesContactDetails() {
        assertThat(VALIDATOR.validateValue(FlatmateRoomCreateRequest.class, "note", MOBILE)).isNotEmpty();
        assertThat(VALIDATOR.validateValue(FlatmateRoomCreateRequest.class, "lifestyle", List.of(MOBILE))).isNotEmpty();
        assertThat(VALIDATOR.validateValue(FlatmateRoomDetails.class, "street", MOBILE)).isNotEmpty();
        assertThat(VALIDATOR.validateValue(FlatmateRoomDetails.class, "landmark", "me@gmail.com")).isNotEmpty();
    }

    @Test
    void ordinaryRoomTextPasses() {
        assertThat(VALIDATOR.validateValue(FlatmateRoomCreateRequest.class, "note", "Quiet flat, 2 mins from Baner Road")).isEmpty();
        assertThat(VALIDATOR.validateValue(FlatmateRoomCreateRequest.class, "lifestyle", List.of("Non-smoker"))).isEmpty();
        assertThat(VALIDATOR.validateValue(FlatmateRoomDetails.class, "street", "Lane 5, Survey No 123/4")).isEmpty();
        assertThat(VALIDATOR.validateValue(FlatmateRoomDetails.class, "landmark", "Opp. D-Mart")).isEmpty();
    }
}
