package com.draazy.api.services.request;

import com.draazy.api.common.trust.AgreementCreditUsageLookup;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Its own bean: billing reads this count, and the spend side depends on billing.
@Service
class AgreementCreditUsage implements AgreementCreditUsageLookup {

    private final ServiceRequestRepository requests;

    AgreementCreditUsage(ServiceRequestRepository requests) {
        this.requests = requests;
    }

    @Override
    @Transactional(readOnly = true)
    public long agreementCreditsHeld(UUID userId) {
        return userId == null ? 0L : requests.countReferralCreditsHeld(userId);
    }
}
