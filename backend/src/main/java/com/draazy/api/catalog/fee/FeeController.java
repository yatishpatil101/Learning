package com.draazy.api.catalog.fee;

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
 * <p>No service layer: there is no decision to make between the repository and the wire. Adding one
 * would be a class whose entire body is a delegation.
 */
@RestController
public class FeeController {

    private final PlatformFeeRepository fees;
    private final FeeMapper feeMapper;

    public FeeController(PlatformFeeRepository fees, FeeMapper feeMapper) {
        this.fees = fees;
        this.feeMapper = feeMapper;
    }

    /**
     * {@code GET /fees} — every published breakdown (spec fix S24: an array, because the table is
     * keyed by deal and a single object could never say which deal it described).
     */
    @GetMapping(Routes.Fees.BASE)
    @Transactional(readOnly = true)
    public List<FeeResponse> list() {
        return fees.findAllByOrderByDealAsc().stream().map(feeMapper::toResponse).toList();
    }
}
