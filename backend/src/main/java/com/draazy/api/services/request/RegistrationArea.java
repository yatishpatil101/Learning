package com.draazy.api.services.request;

import com.draazy.api.catalog.locality.LocalityRepository;
import com.draazy.api.catalog.locality.LocalityResolver;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

// Decides which body a rent agreement registers with, and so its registration fee (D-h).
@Component
class RegistrationArea {

    static final String URBAN = "Municipal / Urban";
    static final String RURAL = "Rural";
    private static final String GRAM_PANCHAYAT = "gram-panchayat";

    private final LocalityResolver resolver;
    private final LocalityRepository localities;

    RegistrationArea(LocalityResolver resolver, LocalityRepository localities) {
        this.resolver = resolver;
        this.localities = localities;
    }

    Map<String, Object> stamped(Map<String, Object> details) {
        Map<String, Object> next = new LinkedHashMap<>(details == null ? Map.of() : details);
        Map<String, Object> state = new LinkedHashMap<>(ServiceRequestPricing.childObject(next, "_state"));
        Map<String, Object> terms = new LinkedHashMap<>(ServiceRequestPricing.childObject(state, "terms"));
        boolean rural = gramPanchayat(ServiceRequestPricing.childObject(state, "prop").get("locality"));
        next.put("regArea", rural ? RURAL : URBAN);
        terms.remove("regArea");
        if (!terms.isEmpty()) {
            state.put("terms", terms);
        }
        state.put("regArea", rural ? "rural" : "urban");
        next.put("_state", state);
        return next;
    }

    private boolean gramPanchayat(Object locality) {
        if (!(locality instanceof String name) || name.isBlank()) {
            return false;
        }
        String slug = resolver.resolve(name, null, null);
        return slug != null && localities.findById(slug).map(l -> GRAM_PANCHAYAT.equals(l.getRegistrationBody())).orElse(false);
    }
}
