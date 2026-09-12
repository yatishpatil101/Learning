package com.draazy.api.moderation.property;

import com.draazy.api.catalog.listing.ListingCreate;
import com.draazy.api.common.validation.IndianMobile;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code POST /admin/properties} — a listing taken over the phone.
 *
 * <p>A wrapper around the ordinary {@link ListingCreate} rather than a parallel shape with an extra
 * field, so that the listing an operator types and the listing an owner types are validated by the
 * same constraints and mapped by the same allowlist. If the two ever diverge it will be because
 * somebody chose it, not because one of them was copied and then edited.
 *
 * @param ownerMobile the owner's number, and the identity the listing is attributed to. Not an id:
 *                    the operator is on a phone call with somebody who has never signed in, so the
 *                    only handle that exists is the number they are calling from
 * @param ownerName   the owner's name as given, used only if the account has to be created. Ignored
 *                    for an account that already exists — an operator's transcription of a name
 *                    heard over a phone call must not overwrite what the owner typed themselves
 * @param listing     the listing itself, identical to what {@code POST /me/listings} accepts
 */
public record OnBehalfListingRequest(
        @NotBlank @IndianMobile String ownerMobile,
        @Size(max = 120) String ownerName,
        @NotNull @Valid ListingCreate listing) {
}
