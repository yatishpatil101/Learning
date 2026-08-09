package com.punenest.api.deals.deal;

import com.punenest.api.common.validation.IndianMobile;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The request body for {@code POST /me/deals/{propId}/parties} (contract {@code DealParty} input).
 *
 * <p>{@code mobile} carries {@code @IndianMobile}: the shape is tolerated at the edge (spacing, a
 * {@code +91} prefix) but {@link DealService#addParty} normalises it to the canonical ten digits
 * before storing, so a later masked read resolves. It used to store the value <em>unnormalised</em>
 * (D23a), so an off-shape number was persisted verbatim and {@code MobileMask.mask} then answered
 * {@code null} — it returns {@code null} for anything that is not exactly ten digits.
 *
 * @param name   the party's name (required)
 * @param note   optional private note
 */
public record DealPartyCreateRequest(
        @NotBlank @Size(max = 120) String name,
        @IndianMobile
        String mobile,
        @Size(max = 500) String note) {
}
