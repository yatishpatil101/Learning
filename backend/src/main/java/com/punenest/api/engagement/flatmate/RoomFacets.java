package com.punenest.api.engagement.flatmate;

/**
 * The room-feed filter exactly as the page offers it. Every field is optional and a null one
 * widens rather than narrows, so the all-null instance is the default, unfiltered page load. The
 * preference facets ({@code gender}, {@code food}) additionally read the literal {@code any} as no
 * preference — see {@link FlatmateVocabulary#facetOrNull}. Budgets are whole rupees, matched
 * against the room's own per-basis figure.
 *
 * <p>A record rather than eight positional method arguments: six of them are {@code String}, and a
 * transposed {@code gender}/{@code food} pair would be a silent wrong-answer bug that no type
 * checker could catch. Named components make that transposition impossible to write.
 */
public record RoomFacets(String locality, String gender, String food, String roomType,
        String furnishing, String bhk, Long minBudget, Long maxBudget, Boolean verifiedOnly) {
}
