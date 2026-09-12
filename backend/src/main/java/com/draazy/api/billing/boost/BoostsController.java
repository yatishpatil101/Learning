package com.draazy.api.billing.boost;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The promotion price list and buying a window on one's own listing. */
@RestController
public class BoostsController {

    private final BoostService service;

    public BoostsController(BoostService service) {
        this.service = service;
    }

    /** {@code GET /boost-packs} (contract {@code listBoostPacks}) — public, {@code security: []}. */
    @GetMapping(Routes.Boosts.PACKS)
    public List<BoostPackDto> listPacks() {
        return service.listPacks();
    }

    /**
     * {@code GET /me/properties/{propId}/boost} (contract {@code listListingBoosts}) — owner-scoped.
     *
     * <p>Every boost bought for this listing, newest first, including ones that never opened. See
     * {@link BoostService#listForListing}.
     */
    @GetMapping(Routes.Boosts.LISTING)
    public List<BoostDto> listForListing(@CurrentUser AuthPrincipal principal,
            @PathVariable String propId) {
        return service.listForListing(principal, propId);
    }

    /**
     * {@code POST /me/properties/{propId}/boost} (contract {@code boostListing}, spec fix S51) — 201.
     *
     * @param idempotencyKey the contract's {@code Idempotency-Key}; a repeat returns the original row
     */
    @PostMapping(Routes.Boosts.LISTING)
    @ResponseStatus(HttpStatus.CREATED)
    public BoostDto boost(@CurrentUser AuthPrincipal principal, @PathVariable String propId,
            @Valid @RequestBody BoostRequest body,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
        return service.boost(principal, propId, body.packId(), idempotencyKey);
    }

    /** Body of {@code boostListing} — an inline object in the contract, so no named schema. */
    public record BoostRequest(@NotBlank String packId) {
    }
}
