package com.draazy.api.services.request;

import com.draazy.api.billing.entitlement.EntitlementService;
import org.springframework.stereotype.Service;

// Spends one referral-earned free agreement: Draazy's own fee and its GST go, statutory charges stay.
@Service
class ServiceRequestReferralCredit {

    private final ServiceRequestRepository requests;
    private final EntitlementService entitlements;
    private final ServiceRequestPricing pricing;

    ServiceRequestReferralCredit(ServiceRequestRepository requests, EntitlementService entitlements,
            ServiceRequestPricing pricing) {
        this.requests = requests;
        this.entitlements = entitlements;
        this.pricing = pricing;
    }

    // The caller holds the request's row lock inside a transaction. Returns true only when this call spent a credit.
    boolean spend(ServiceRequest request) {
        if (request.isReferralCredit() || request.getPaymentRef() != null
                || !ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())
                || request.getAmount() == null) {
            return false;
        }
        requests.lockUser(request.getRequesterId());
        if (entitlements.freeAgreementsRemaining(request.getRequesterId()) < 1) {
            return false;
        }
        request.spendReferralCredit(Math.min(request.getAmount(), pricing.statutory(request.getDetails())));
        return true;
    }
}
