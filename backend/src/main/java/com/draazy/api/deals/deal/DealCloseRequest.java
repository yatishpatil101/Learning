package com.draazy.api.deals.deal;

import com.draazy.api.common.validation.IndianMobile;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/**
 * The request body for {@code POST /me/deals/{propId}/close} (contract {@code DealCloseRequest}).
 *
 * <p>{@code counterpartyMobile} is the contract's {@code Mobile} schema. It used to be spelled
 * {@code ^[0-9]{10,15}$} here (D23a), which let off-contract input through the bean-validation
 * layer and left {@link DealService#close} to reject it as a 400 instead of the 422 every other
 * malformed field produces. Aligning the pattern moves the refusal back to where the contract says
 * it belongs; {@code MobileMask.normalise} still runs behind it as the fail-closed backstop.
 *
 * @param agreedPrice        whole INR — the agreed transaction price
 * @param counterpartyMobile the other party's mobile (may be off-platform)
 */
public record DealCloseRequest(
        @NotNull @Positive Long agreedPrice,
        @NotNull @IndianMobile
        String counterpartyMobile,
        @Size(max = 1000) String note) {
}
