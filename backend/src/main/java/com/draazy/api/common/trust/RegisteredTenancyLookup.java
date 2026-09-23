package com.draazy.api.common.trust;

import java.util.UUID;

/** Answers whether Draazy holds a registered tenancy for a tenant and property. */
public interface RegisteredTenancyLookup {

    boolean hasRegisteredTenancy(UUID propertyId, String tenantMobile);
}
