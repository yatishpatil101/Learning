package com.draazy.api.catalog.listing;

/** The two numbers the wizard paywall draws: the owner's ceiling and the slots they hold. */
public record ListingSlots(int allowance, long used) {
}
