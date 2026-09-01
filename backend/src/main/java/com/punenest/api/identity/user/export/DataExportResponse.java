package com.punenest.api.identity.user.export;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * <strong>The document a data subject receives when they exercise their right of access.</strong>
 *
 * <p>Three shape decisions are worth defending, because the obvious alternative was taken and
 * rejected in each case.
 *
 * <h2>One array of uniform datasets, not one object per domain</h2>
 *
 * <p>The natural JSON for this is an object whose keys are table names — {@code {"properties": […],
 * "tenancies": […]}}. It reads beautifully and it is a bad contract. Every dataset would be a
 * distinct schema in the OpenAPI document, so adding a table would be an API change; a client
 * wanting to render "everything" would have to enumerate seventy keys it cannot know in advance; and
 * there would be nowhere to hang the per-dataset facts that matter most — whether the rows were
 * truncated, and which columns were deliberately left out.
 *
 * <p>A uniform array fixes all three. The contract is two object shapes rather than seventy, a
 * client can render an unknown dataset without being taught about it, and every dataset carries its
 * own honesty alongside its own data.
 *
 * <h2>Empty datasets are included</h2>
 *
 * <p>A dataset the subject has no rows in is returned with {@code rowCount: 0} rather than dropped.
 * This costs a few hundred bytes and buys the single property that makes the document trustworthy:
 * <strong>an export that omits its empty datasets is indistinguishable from one that forgot
 * them.</strong> A subject who sees no {@code personal_documents} entry cannot tell whether the
 * platform holds no KYC papers or simply did not look. A subject who sees {@code personal_documents}
 * with zero rows knows.
 *
 * <h2>The document says what it left out</h2>
 *
 * <p>{@link #excluded} and {@link Dataset#withheld} exist because {@code ErasureRetention}
 * established the standard: its {@code knownGaps()} lists, in the subject's own erasure record, the
 * places the sweep does not reach. The same argument applies with more force to an access request.
 * A response that silently omits a table is a response that quietly asserts the table does not
 * exist, and the subject has no way to know they should have asked. Naming the omission converts a
 * hidden gap into something they can challenge.
 *
 * @param generatedAt   when the document was produced. Not a cache key — a read this wide is a
 *                      point-in-time statement and anybody reasoning about it later needs to know
 *                      which point in time
 * @param subjectId     whose data this is, echoed so the document is self-describing once it has
 *                      been detached from the request that produced it
 * @param schemaVersion the version of <em>this envelope</em>. Bumped only when the envelope changes
 *                      shape, not when a dataset is added, because adding a dataset is precisely
 *                      what the uniform array was chosen to make a non-event
 * @param redactionRule the rule applied to shared records, in prose, in the document. See {@link
 *                      DataExportScope#redactionRule()}
 * @param rowLimit      the per-dataset row cap in force for this response
 * @param datasets      every dataset in scope, in a stable domain order, including empty ones
 * @param excluded      tables holding data about the subject that this export deliberately does not
 *                      return, each with its reason
 */
public record DataExportResponse(
        Instant generatedAt,
        UUID subjectId,
        int schemaVersion,
        String redactionRule,
        int rowLimit,
        List<Dataset> datasets,
        List<Exclusion> excluded) {

    /** Bumped when the envelope changes shape. Adding a dataset is not a shape change. */
    public static final int SCHEMA_VERSION = 1;

    /**
     * One table's worth of the subject's data.
     *
     * @param domain    the grouping this belongs to — {@code account}, {@code identity}, {@code
     *                  listings}, {@code enquiries}, {@code agreements}, {@code messaging}, {@code
     *                  support}, {@code community}, {@code flatmate}
     * @param name      the dataset's name, usually the underlying table's. Naming the real table is
     *                  part of the disclosure: it is what lets a subject ask a follow-up question
     *                  precise enough to be answerable
     * @param describes one sentence explaining the dataset to a non-technical reader, who is the
     *                  only guaranteed reader of this document
     * @param rowCount  rows actually returned, which equals {@code rows.size()} and is stated
     *                  separately so a client can show a summary without walking the array
     * @param truncated whether the row cap cut this dataset short. Never silently: a truncated
     *                  dataset that did not say so would be a false statement about what is held
     * @param withheld  columns present in the table and deliberately absent from every row, keyed by
     *                  column name, valued by the reason
     * @param rows      the data. Each row is a JSON object whose keys are the selected column names
     *                  and whose values are strings, numbers, booleans, nulls, or — for {@code
     *                  jsonb} columns — nested objects and arrays. Deliberately free-form: pinning
     *                  seventy row schemas in the contract would make every migration an API change
     */
    public record Dataset(
            String domain,
            String name,
            String describes,
            int rowCount,
            boolean truncated,
            Map<String, String> withheld,
            List<Map<String, Object>> rows) {
    }

    /**
     * A table left out of the export entirely.
     *
     * @param name   what was excluded, in the same vocabulary as {@link Dataset#name}
     * @param reason why. Written to be read by the subject, and to be defensible to a regulator
     *               reading it over their shoulder
     */
    public record Exclusion(String name, String reason) {
    }
}
