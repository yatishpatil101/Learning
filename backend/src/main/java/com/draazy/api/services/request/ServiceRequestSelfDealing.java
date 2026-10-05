package com.draazy.api.services.request;

import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
class ServiceRequestSelfDealing {

    private final ServiceRequestPartyRepository parties;
    private final PropertyRepository properties;
    private final UserRepository users;

    ServiceRequestSelfDealing(ServiceRequestPartyRepository parties, PropertyRepository properties,
            UserRepository users) {
        this.parties = parties;
        this.properties = properties;
        this.users = users;
    }

    void refuse(AuthPrincipal caller, ServiceRequest request) {
        UUID me = caller.userId();
        if (me.equals(request.getRequesterId())
                || parties.existsByRequestIdAndUserId(request.getId(), me)
                || isListingSide(me, request.getPropertyId())
                || isTypedParty(me, request)) {
            throw new ForbiddenException(
                    "You are a party to this request, so a colleague has to work it.");
        }
    }

    private boolean isTypedParty(UUID me, ServiceRequest request) {
        Set<String> typed = typedMobiles(request);
        return !typed.isEmpty() && users.findById(me).map(u -> RentAgreementRegistration.validMobile(u.getMobile())).filter(typed::contains).isPresent();
    }

    private static Set<String> typedMobiles(ServiceRequest request) {
        Set<String> out = new HashSet<>(RentAgreementRegistration.formTenants(request).keySet());
        Map<String, Object> details = request.getDetails() == null ? Map.of() : request.getDetails();
        Map<String, Object> state = ServiceRequestPricing.childObject(details, "_state");
        Map<String, Object> wit = ServiceRequestPricing.childObject(state, "wit");
        addMobile(out, ServiceRequestPricing.childObject(state, "owner").get("oMobile"));
        addMobile(out, wit.get("w1Mobile"));
        addMobile(out, wit.get("w2Mobile"));
        if (state.get("coOwners") instanceof List<?> rows) {
            rows.forEach(row -> {
                if (row instanceof Map<?, ?> coOwner) {
                    addMobile(out, coOwner.get("mobile"));
                }
            });
        }
        return out;
    }

    private static void addMobile(Set<String> out, Object raw) {
        String mobile = raw instanceof String text ? RentAgreementRegistration.validMobile(text) : null;
        if (mobile != null) {
            out.add(mobile);
        }
    }

    private boolean isListingSide(UUID me, UUID propertyId) {
        return propertyId != null && properties.findById(propertyId).filter(p -> me.equals(p.getOwner().getId())
                        || me.toString().equals(p.getPostedByStaff())).isPresent();
    }
}
