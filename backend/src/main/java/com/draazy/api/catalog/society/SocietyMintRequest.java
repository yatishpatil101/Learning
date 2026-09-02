package com.draazy.api.catalog.society;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Adding a society the catalogue does not have.
 *
 * <p>Deliberately thin. Everything else a society record can hold — builder, towers, maintenance,
 * amenities — arrives later as a community proposal that ops screen, because a person who is
 * halfway through listing a flat or following a building is not going to fill in a survey, and a
 * form that asks them to is a form they abandon. What is needed here is the least that makes the
 * society findable by somebody else.
 *
 * @param name the society as its residents write it
 * @param localityLabel the human locality, folded into the slug so two societies of the same name
 *     in different suburbs do not collide. Not stored; {@code localitySlug} is
 * @param localitySlug the canonical locality, when the caller resolved one. Null is fine and common:
 *     the column is a foreign key to {@code localities}, so an unrecognised area must arrive as null
 *     rather than as a guess that fails the insert
 * @param lat optional pin, when the caller picked one on a map
 * @param lng optional pin
 * @param mintOrigin which surface the caller is on — {@code demand} for the searcher-facing Society
 *     Finder, {@code listing} for the listing wizard. The one field here that is not about the
 *     building: it is what lets ops separate "somebody wants a flat in this building" from
 *     "somebody is selling one", which is the entire question the finder exists to answer and which
 *     no other field on this record can reconstruct. Optional, and defaulted rather than rejected
 *     when absent, because a client shipped before this field existed must keep minting
 */
public record SocietyMintRequest(
        @NotBlank @Size(max = 160) String name,
        @Size(max = 120) String localityLabel,
        @Size(max = 120) String localitySlug,
        @DecimalMin("-90.0") @DecimalMax("90.0") Double lat,
        @DecimalMin("-180.0") @DecimalMax("180.0") Double lng,
        @Size(max = 16) String mintOrigin) {
}
