package com.punenest.api.moderation.duplicate;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

/**
 * "Keep this one, archive the others."
 *
 * @param keepId  the listing that stays live.
 * @param dropIds the listings to archive. Sent explicitly rather than inferred from the cluster,
 *                because the operator's screen and the server's derivation are two moments apart:
 *                a listing that joined the cluster in between is one the operator never saw, and
 *                inferring the losers would archive it on their behalf.
 */
public record DuplicateMergeRequest(
        @NotBlank String keepId,
        @NotEmpty List<String> dropIds) {
}
