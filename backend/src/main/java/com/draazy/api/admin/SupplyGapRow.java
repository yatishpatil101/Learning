package com.draazy.api.admin;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * One locality on the supply-gap report.
 *
 * <p><strong>Counts, and nothing that could identify anybody.</strong> The demand half of this row
 * is built from {@code demand_signals}, which is written by anonymous visitors. The record carries
 * no user id, no mobile and no per-event detail, and that is a constraint on the response rather
 * than an accident of what was convenient: the moment a report can be drilled from "42 people
 * searched Wakad" down to who they were, an anonymous telemetry table has become a behavioural
 * profile of people who never agreed to one.
 *
 * <p><strong>Why {@code gap} is served rather than left to the client.</strong> It is
 * {@code demand - supply}, which is arithmetic the browser could do — but the weighting inside
 * {@code demand} is not, and a client that computed its own gap from the three raw counts would
 * silently disagree with the server's the moment the weights changed. One definition, one place.
 *
 * @param localitySlug the slug as recorded; null means the visitor named no locality, which is a
 *                     real answer and not a missing one
 * @param localityName resolved for display; absent when the slug matches no known locality, which
 *                     is the interesting case — somebody asked for somewhere Draazy does not cover
 * @param supply       live, approved, unarchived listings in the locality right now
 * @param searches     demand signals of kind {@code search} in the window
 * @param alerts       demand signals of kind {@code alert} in the window — a stronger signal, since
 *                     the visitor asked to be told when something appears
 * @param views        demand signals of kind {@code view} in the window
 * @param repeatSeekers signed-in people who searched this locality three or more times in the
 *                     window. Signed-in only, and knowingly an undercount: without an account there
 *                     is nothing that tells one person searching three times apart from three
 *                     people searching once. The browser version pretended otherwise by stamping
 *                     every anonymous search with the same literal user id
 * @param demand       the weighted total; see {@link AdminSupplyGapService} for the weights
 * @param gap          {@code demand - supply}; positive means more wanted than listed
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SupplyGapRow(
        String localitySlug,
        String localityName,
        long supply,
        long searches,
        long alerts,
        long views,
        long repeatSeekers,
        long demand,
        long gap) {
}
