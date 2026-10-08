package com.draazy.api.provider.places;

import com.draazy.api.provider.PlacesLookup;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

// Place Details (New). One GET, so Spring's RestClient with short timeouts rather than a Google SDK.
@Component
@ConditionalOnExpression("!'${draazy.google.places.server-key:}'.isBlank()")
public class GooglePlacesLookup implements PlacesLookup {

    private static final String FIELDS = "id,displayName,location,types,addressComponents";

    private static final Pattern REASON = Pattern.compile("\"(?:reason|status)\"\\s*:\\s*\"([A-Z_]+)\"");
    private static final Pattern KEY_PROBLEM = Pattern.compile("API_KEY|PERMISSION_DENIED|REQUEST_DENIED|UNAUTHENTICATED|SERVICE_DISABLED|BILLING");

    private final RestClient http;

    public GooglePlacesLookup(
            @Value("${draazy.google.places.server-key}") String serverKey,
            @Value("${draazy.google.places.base-url:https://places.googleapis.com}") String baseUrl,
            @Value("${draazy.google.places.connect-timeout-seconds:2}") long connectSeconds,
            @Value("${draazy.google.places.read-timeout-seconds:4}") long readSeconds) {
        SimpleClientHttpRequestFactory timeouts = new SimpleClientHttpRequestFactory();
        timeouts.setConnectTimeout(Duration.ofSeconds(connectSeconds));
        timeouts.setReadTimeout(Duration.ofSeconds(readSeconds));
        this.http = RestClient.builder()
                .requestFactory(timeouts)
                .baseUrl(baseUrl)
                .defaultHeader("X-Goog-Api-Key", serverKey.trim())
                .defaultHeader("X-Goog-FieldMask", FIELDS)
                .build();
    }

    @Override
    public Optional<Place> details(String placeId, Place hint) {
        Map<?, ?> body;
        try {
            body = http.get().uri("/v1/places/{id}", placeId).retrieve().body(Map.class);
        } catch (HttpClientErrorException e) {
            int status = e.getStatusCode().value();
            String reason = reason(e.getResponseBodyAsString());
            // A 400 about the id is as unknown as a missing place; a 400 about the key says nothing about the place.
            if (status == 404 || (status == 400 && !KEY_PROBLEM.matcher(reason).find())) {
                return Optional.empty();
            }
            throw new UnavailableException("Places lookup rejected with " + status + " " + reason, null);
        } catch (RestClientException e) {
            throw new UnavailableException("Places lookup failed: " + e.getClass().getSimpleName(), e);
        }
        return body == null ? Optional.empty() : Optional.ofNullable(parse(placeId, body));
    }

    private static String reason(String body) {
        Matcher m = REASON.matcher(body == null ? "" : body);
        Set<String> found = new LinkedHashSet<>();
        while (m.find()) {
            found.add(m.group(1));
        }
        return found.isEmpty() ? "unknown" : String.join("/", found);
    }

    private static Place parse(String placeId, Map<?, ?> body) {
        String name = text(body.get("displayName"));
        if (name == null || name.isBlank()) {
            return null;
        }
        Double lat = null;
        Double lng = null;
        if (body.get("location") instanceof Map<?, ?> location) {
            lat = number(location.get("latitude"));
            lng = number(location.get("longitude"));
        }
        String canonical = body.get("id") instanceof String id && !id.isBlank() ? id.trim() : placeId;
        return new Place(canonical, name.trim(), lat, lng, pincode(body.get("addressComponents")), strings(body.get("types")));
    }

    private static String text(Object displayName) {
        return displayName instanceof Map<?, ?> m && m.get("text") instanceof String s ? s : null;
    }

    private static Double number(Object value) {
        return value instanceof Number n ? n.doubleValue() : null;
    }

    private static List<String> strings(Object value) {
        List<String> out = new ArrayList<>();
        if (value instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof String s) {
                    out.add(s);
                }
            }
        }
        return out;
    }

    private static String pincode(Object components) {
        if (components instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> c && strings(c.get("types")).contains("postal_code")
                        && c.get("longText") instanceof String s) {
                    return s;
                }
            }
        }
        return null;
    }
}
