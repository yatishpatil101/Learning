package com.draazy.api.documents.agreement;

import com.draazy.api.common.trust.RegisteredTenancyLookup;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
class DraazyRegisteredTenancyLookup implements RegisteredTenancyLookup {

    private final RentAgreementRepository agreements;

    DraazyRegisteredTenancyLookup(RentAgreementRepository agreements) {
        this.agreements = agreements;
    }

    @Override
    public boolean hasRegisteredTenancy(UUID propertyId, String tenantMobile) {
        return agreements.hasRegisteredTenancy(propertyId, tenantMobile);
    }
}
