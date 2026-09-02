package com.draazy.api.catalog.listing;

import jakarta.validation.constraints.Size;

/**
 * "Have I already listed this?" — the fields the wizard has in hand when it is about to create a
 * listing, sent so the server can answer against the caller's own rows before the form is submitted.
 *
 * <p>Deliberately the <em>same</em> fields {@link ListingCreate} carries, under the same names and
 * the same size limits, and no others. The check has to derive exactly the key the create would
 * derive; the moment the two take different inputs the pre-check starts answering a question about
 * a listing that is not the one being posted, which is worse than not asking. The size limits are
 * copied for the same reason {@code ListingCreate} carries them: both values reach a btree index
 * (V79), and an over-long one is a 500 on a route any authenticated account can call.
 *
 * <p><strong>Why there is no {@code excludeId}.</strong> The only caller asks before a create, where
 * there is nothing to exclude. On an edit the answer is trivially "yes, itself", which is why the
 * wizard does not ask — an exclude parameter would exist solely to let a caller that should not be
 * calling get a sensible answer.
 *
 * <p><strong>Why there is no {@code pmcPropertyId}.</strong> The browser's fingerprint has a tax-ID
 * arm; the {@code properties} table has no such column, so the server cannot answer on it. Declaring
 * a field the check silently ignores would read as coverage the server does not have.
 */
public record ListingDuplicateCheck(
        @Size(max = 300) String address,
        String locality,
        String city,
        Double lat,
        Double lng,
        @Size(max = 64) String electricityMeterNo) {
}
