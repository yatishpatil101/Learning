package com.draazy.api.leads.conversation;

import com.draazy.api.common.validation.IndianMobile;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ConversationCreate(
        @IndianMobile
        String counterpartyMobile,
        @Size(max = 64) String propertyId,
        @NotBlank @Size(max = 4000) String body) {

    // Blank mobiles still fail validation; callers should omit the field instead.
    // "You addressed nobody" is request shape, not a trust decision.
    @AssertTrue(message = "counterpartyMobile is required unless propertyId names a listing")
    public boolean isAddressed() {
        return !blank(counterpartyMobile) || !blank(propertyId);
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
    }
