package com.punenest.api.finance.rental;

import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The tenant's self-declared rentals at {@code /me/rentals}.
 *
 * <p>No {@code @PreAuthorize}: the spec carries no {@code x-roles} on these operations, and adding
 * a role guard would restrict a surface every authenticated user is entitled to — a tenant is not a
 * role on this platform, it is a thing a person happens to be. Authentication plus caller-scoping
 * in {@link TenantRentalService} is the whole gate.
 *
 * <p><strong>Unpaged list.</strong> A person rents one home at a time; the count is bounded by how
 * often they move rather than by anything they can do to the platform, so a page envelope would be
 * something the dashboard unwraps on every read to solve a problem nobody has.
 */
@RestController
public class MeRentalsController {

    private final TenantRentalService rentalService;

    public MeRentalsController(TenantRentalService rentalService) {
        this.rentalService = rentalService;
    }

    /** {@code GET /me/rentals} (contract {@code myRentals}). */
    @GetMapping(Routes.Rentals.MINE)
    public List<TenantRentalDto> myRentals(@CurrentUser AuthPrincipal principal) {
        return rentalService.myRentals(principal.userId());
    }

    /** {@code POST /me/rentals} (contract {@code addRental}) — 201. */
    @PostMapping(Routes.Rentals.MINE)
    @ResponseStatus(HttpStatus.CREATED)
    public TenantRentalDto addRental(@CurrentUser AuthPrincipal principal,
                                     @Valid @RequestBody TenantRentalCreateRequest body) {
        return rentalService.addRental(principal.userId(), body);
    }

    /**
     * {@code PATCH /me/rentals/{rentalId}} (contract {@code updateRental}) — a genuine partial
     * update; absent fields are left alone.
     */
    @PatchMapping(Routes.Rentals.BY_ID)
    public TenantRentalDto updateRental(@CurrentUser AuthPrincipal principal,
                                        @PathVariable("rentalId") String rentalId,
                                        @Valid @RequestBody TenantRentalUpdateRequest body) {
        return rentalService.updateRental(principal.userId(), parseUuid(rentalId), body);
    }

    /** {@code DELETE /me/rentals/{rentalId}} (contract {@code deleteRental}) — 204. */
    @DeleteMapping(Routes.Rentals.BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteRental(@CurrentUser AuthPrincipal principal,
                             @PathVariable("rentalId") String rentalId) {
        rentalService.deleteRental(principal.userId(), parseUuid(rentalId));
    }

    /**
     * A malformed rental id is 404, not 400 — the same rule the ledger applies to a property id.
     * "Your id is the wrong shape" and "no such rental" are different answers only to someone
     * testing which ids are worth trying.
     */
    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElseThrow(() -> NotFoundException.of("Rental"));
    }
}
