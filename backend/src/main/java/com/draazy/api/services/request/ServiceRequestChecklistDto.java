package com.draazy.api.services.request;

import java.util.List;

/**
 * The paperwork one service request needs, and how much of it has arrived (D120).
 *
 * <p><strong>Derived, never stored.</strong> Every field on this record is computed at read time
 * from the request's own vault documents. There is no checklist table, no {@code status} column
 * a desk can tick by hand, and therefore no way for "verified" to disagree with "there is a file".
 * The alternative — persisting an item row per request — was rejected because it creates a second
 * source of truth for the same fact, and the failure mode of a second source of truth for
 * <em>paperwork</em> is a Leave &amp; License drafted from a document nobody actually uploaded.
 *
 * <p><strong>Why the counts are on the envelope.</strong> {@code ready}/{@code total} is what the
 * tracker's document column renders ("3 of 5"); deriving it client-side means every surface that
 * shows the badge re-implements the same fold, and they drift. Computed once, here, from the same
 * list the caller can see, so the summary and the detail can never disagree.
 *
 * @param ready how many items have at least one document against them
 * @param total how many items this request asks for — the length of {@link #items()}
 * @param items every item, present or not, in a fixed order; the missing ones are the point
 */
public record ServiceRequestChecklistDto(int ready, int total, List<Item> items) {

    /**
     * One named piece of paperwork.
     *
     * @param id         the stable slug. Also the {@code category} to upload under: a client that
     *                   wants to satisfy an item posts to {@code /service-requests/{id}/docs} with
     *                   this exact string, so the vocabulary the checklist reads and the vocabulary
     *                   a client writes are the same list rather than two lists kept in step by
     *                   hand
     * @param name       what to show a person
     * @param done       whether {@link #documentId()} is present. Redundant with it, and
     *                   deliberately so: the renderer wants a boolean and should not have to know
     *                   that null means missing
     * @param documentId the newest document filed under this item, or {@code null}. An id rather
     *                   than a URL, so this endpoint never mints a download credential — the bytes
     *                   stay behind {@code GET /service-requests/{id}}, which is where the vault's
     *                   own read rules already live
     */
    public record Item(String id, String name, boolean done, String documentId) {}
}
