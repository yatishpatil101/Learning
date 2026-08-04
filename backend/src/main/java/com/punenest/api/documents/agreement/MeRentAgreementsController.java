package com.punenest.api.documents.agreement;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The owner's rent-agreement records at {@code /me/rent-agreements}. */
@RestController
public class MeRentAgreementsController {

    private final RentAgreementService agreementService;

    public MeRentAgreementsController(RentAgreementService agreementService) {
        this.agreementService = agreementService;
    }

    /** {@code GET /me/rent-agreements} (contract {@code myRentAgreements}). */
    @GetMapping(Routes.MeRentAgreements.BASE)
    public List<RentAgreementDto> myRentAgreements(@CurrentUser AuthPrincipal principal) {
        return agreementService.mine(principal.userId());
    }

    /**
     * {@code POST /me/rent-agreements} (contract {@code createRentAgreement}).
     *
     * <p>Returns the created record (spec fix S38) rather than the contract's original empty
     * {@code 201}: without the server-assigned id, a client had no way to name what it had just
     * created and would have to re-list and guess.
     */
    @PostMapping(Routes.MeRentAgreements.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public RentAgreementDto createRentAgreement(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody RentAgreementCreate body) {
        return agreementService.create(principal.userId(), body);
    }
}
