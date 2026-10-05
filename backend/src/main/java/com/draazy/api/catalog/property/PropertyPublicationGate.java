package com.draazy.api.catalog.property;

import com.draazy.api.security.AuthPrincipal;

public interface PropertyPublicationGate {
    void requirePublishable(AuthPrincipal actor, Property property, boolean secondApprovalSatisfied);
}
