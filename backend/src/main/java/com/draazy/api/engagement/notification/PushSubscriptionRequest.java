package com.draazy.api.engagement.notification;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record PushSubscriptionRequest(
        @NotBlank String endpoint,
        @Valid @NotNull Keys keys) {

    public record Keys(@NotBlank String p256dh, @NotBlank String auth) {
    }
}
