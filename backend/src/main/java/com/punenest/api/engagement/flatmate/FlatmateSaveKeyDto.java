package com.punenest.api.engagement.flatmate;

import java.util.UUID;

/**
 * One entry in the caller's flatmate shortlist, as a key rather than a card.
 *
 * <p>What the flatmates board asks for: it is already holding the cards and only needs to know which
 * of them are bookmarked. The Saved page asks the other question and gets full projections from
 * {@code GET /me/flatmate-saves}.
 *
 * @param kind which table {@code id} points at — {@code room}, {@code group} or {@code post}
 * @param id the saved row
 */
public record FlatmateSaveKeyDto(String kind, UUID id) {
}
