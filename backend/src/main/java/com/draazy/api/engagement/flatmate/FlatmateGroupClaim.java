package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.Ids;
import java.util.List;
import java.util.UUID;
import java.util.function.BiFunction;
import java.util.function.BooleanSupplier;
import java.util.function.UnaryOperator;

record FlatmateGroupClaim(FlatmateGroupPreferences preferences, String hostRole, boolean declared,
        UUID propertyId, String locality, Long rent) {

    static FlatmateGroupClaim of(FlatmateGroupCreateRequest body, BooleanSupplier declared,
            UnaryOperator<List<String>> canonicalLocalities, BiFunction<String, String, String> canonicalLocality) {
        if (body.hunting()) {
            FlatmateGroupPreferences normal = body.preferences().normalised();
            FlatmateGroupPreferences p = normal.withLocalities(canonicalLocalities.apply(normal.localities()));
            return new FlatmateGroupClaim(p, FlatmateVocabulary.ROLE_TENANT, false, null,
                    p.localities().get(0), p.rentMax());
        }
        return new FlatmateGroupClaim(null,
                FlatmateVocabulary.orDefault(body.role(), FlatmateVocabulary.HOST_ROLE,
                        FlatmateVocabulary.ROLE_TENANT, "role"),
                declared.getAsBoolean(), Ids.parseUuid(body.propertyId()).orElse(null),
                canonicalLocality.apply(body.localitySlug(), body.locality().strip()), body.rent());
    }

    void shape(FlatmateGroup group) {
        if (preferences != null) {
            group.hunt(preferences);
        } else {
            group.settle(locality, rent);
        }
    }
}
