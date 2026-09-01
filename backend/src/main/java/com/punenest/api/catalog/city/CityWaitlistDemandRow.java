package com.punenest.api.catalog.city;

import java.time.Instant;

/**
 * One city on the expansion-demand report: how many distinct people asked for it, and when the most
 * recent ask arrived.
 *
 * <p><strong>An aggregate, and deliberately nothing more.</strong> {@code city_waitlist} holds a
 * mobile and an optional email per row, submitted by unauthenticated visitors — the repository's own
 * docblock refuses a finder on exactly that basis. Returning counts keeps that refusal intact while
 * still answering the question the table exists to answer. The operator deciding the next launch
 * city needs to know that 61 people want Nashik; they do not need those 61 phone numbers, and a
 * back-office grid that listed them would turn a signup form into a contact list one export away
 * from leaving the building.
 *
 * <p><strong>{@code requests} counts people, not rows.</strong> They are the same number here, and
 * only because {@code uq_city_waitlist_mobile_city} makes them the same: one row per
 * {@code (mobile, lower(city))} pair. Without that index a repeat submission would inflate the
 * count, and the report would rank loudest over largest.
 *
 * @param city             a real spelling somebody typed, not an invented canonical form — see
 *                         {@link CityWaitlistRepository#demandByCity()} for why grouping and display
 *                         are two different things here
 * @param requests         distinct people who asked for this city, all time
 * @param lastRequestedAt  the most recent ask; how a city with an old flurry is told apart from one
 *                         that is filling up now, which two equal counts otherwise cannot say
 */
public record CityWaitlistDemandRow(String city, long requests, Instant lastRequestedAt) {
}
