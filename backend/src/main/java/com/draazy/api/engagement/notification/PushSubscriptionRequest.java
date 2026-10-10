package com.draazy.api.engagement.notification;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record PushSubscriptionRequest(
        @NotBlank @Size(max = 2048) String endpoint,
        @Valid @NotNull Keys keys) {

    public record Keys(@NotBlank @Size(max = 256) String p256dh, @NotBlank @Size(max = 256) String auth) {
    }
}
