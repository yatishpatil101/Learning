package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.Ids;
import java.util.UUID;
import java.util.function.BooleanSupplier;

record FlatmateGroupClaim(FlatmateGroupPreferences preferences, String hostRole, boolean declared,
        UUID propertyId, String locality, Long rent) {

    static FlatmateGroupClaim of(FlatmateGroupCreateRequest body, BooleanSupplier declared) {
        if (body.hunting()) {
            FlatmateGroupPreferences p = body.preferences().normalised();
            return new FlatmateGroupClaim(p, FlatmateVocabulary.ROLE_TENANT, false, null,
                    p.localities().get(0), p.rentMax());
        }
        return new FlatmateGroupClaim(null,
                FlatmateVocabulary.orDefault(body.role(), FlatmateVocabulary.HOST_ROLE,
                        FlatmateVocabulary.ROLE_TENANT, "role"),
                declared.getAsBoolean(), Ids.parseUuid(body.propertyId()).orElse(null),
                body.locality().strip(), body.rent());
    }

    void shape(FlatmateGroup group) {
        if (preferences != null) {
            group.hunt(preferences);
        } else {
            group.settle(locality, rent);
        }
    }
}
