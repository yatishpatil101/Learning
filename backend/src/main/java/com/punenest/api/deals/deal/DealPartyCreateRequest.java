package com.punenest.api.deals.deal;

import com.punenest.api.common.validation.Formats;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * The request body for {@code POST /me/deals/{propId}/parties} (contract {@code DealParty} input).
 *
 * <p>{@code mobile} is the contract's {@code Mobile} schema. It used to be spelled
 * {@code ^[0-9]{10,15}$} here, which accepted input the contract rejects (D23a). That mattered
 * beyond tidiness: unlike the close path, {@link DealService#addParty} stores this value
 * <em>unnormalised</em>, so a 15-digit number was persisted verbatim and any masked read of it
 * would return {@code null} — {@code MobileMask.mask} answers {@code null} for anything that is
 * not exactly ten digits.
 *
 * @param name   the party's name (required)
 * @param note   optional private note
 */
public record DealPartyCreateRequest(
        @NotBlank @Size(max = 120) String name,
        @Pattern(regexp = Formats.MOBILE,
                message = Formats.MOBILE_MESSAGE)
        String mobile,
        @Size(max = 500) String note) {
}
