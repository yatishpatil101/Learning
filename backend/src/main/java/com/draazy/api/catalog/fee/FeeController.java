package com.draazy.api.catalog.fee;

import com.draazy.api.common.settings.PlatformSettings;
import com.draazy.api.common.web.Routes;
import java.util.List;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /fees} — the published cost of transacting, one entry per deal intent.
 *
 * <p>Public ({@code security: []}) and deliberately so. A fee schedule that only a signed-in user
 * can read is not transparency; the number is the reason somebody chooses a zero-brokerage platform
 * over a broker, so it has to be visible before the sign-up wall.
 *
 * <p>The rent row's platform fee and its GST come from the admin fee schedule, the same figures
 * {@code ServiceRequestPricing} bills, so the wizard quotes what the customer is charged.
 */
@RestController
public class FeeController {

    private final PlatformFeeRepository fees;
    private final FeeMapper feeMapper;
    private final PlatformSettings settings;

    public FeeController(PlatformFeeRepository fees, FeeMapper feeMapper, PlatformSettings settings) {
        this.fees = fees;
        this.feeMapper = feeMapper;
        this.settings = settings;
    }

    /**
     * {@code GET /fees} — every published breakdown (spec fix S24: an array, because the table is
     * keyed by deal and a single object could never say which deal it described).
     */
    @GetMapping(Routes.Fees.BASE)
    @Transactional(readOnly = true)
    public List<FeeResponse> list() {
        return fees.findAllByOrderByDealAsc().stream()
                .map(feeMapper::toResponse)
                .map(this::withAdminRentFee)
                .toList();
    }

    private FeeResponse withAdminRentFee(FeeResponse fee) {
        if (!PlatformFee.RENT.equals(fee.deal())) {
            return fee;
        }
        long platformFee = settings.rentAgreementPlatform();
        return new FeeResponse(fee.deal(), fee.brokerage(), platformFee, fee.stampDuty(),
                fee.registration(), settings.gstOn(platformFee), fee.notes());
    }
}
