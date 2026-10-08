package com.draazy.api.services.request;

import com.draazy.api.common.error.ValidationException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

// Decides which body a rent agreement registers with, and so its registration fee (D-h).
@Component
class RegistrationArea {

    static final String URBAN = "Municipal / Urban";
    static final String RURAL = "Rural";

    Map<String, Object> stamped(Map<String, Object> details) {
        Map<String, Object> next = new LinkedHashMap<>(details == null ? Map.of() : details);
        Map<String, Object> state = new LinkedHashMap<>(ServiceRequestPricing.childObject(next, "_state"));
        Map<String, Object> terms = new LinkedHashMap<>(ServiceRequestPricing.childObject(state, "terms"));
        Object answer = ServiceRequestPricing.childObject(state, "prop").get("gramPanchayat");
        if (!(answer instanceof Boolean rural)) {
            if (answer != null || ServiceRequestPricing.rentStated(next)) {
                throw new ValidationException(
                        "Say whether the property is under a gram panchayat (_state.prop.gramPanchayat, true or false).");
            }
            return next;
        }
        next.put("regArea", rural ? RURAL : URBAN);
        terms.remove("regArea");
        if (!terms.isEmpty()) {
            state.put("terms", terms);
        }
        state.put("regArea", rural ? "rural" : "urban");
        next.put("_state", state);
        return next;
    }
}