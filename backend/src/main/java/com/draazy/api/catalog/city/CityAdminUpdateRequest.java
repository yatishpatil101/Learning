package com.draazy.api.catalog.city;

import jakarta.validation.constraints.NotNull;

/** The back-office's one mutable city fact: whether shoppers may enter it. */
public record CityAdminUpdateRequest(@NotNull Boolean live) {
}

