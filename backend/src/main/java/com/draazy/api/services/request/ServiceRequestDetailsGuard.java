package com.draazy.api.services.request;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.validation.AadhaarValidator;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

// Guard plaintext details: ops reads this JSON on every queue page.
// Identity numbers belong in the identity endpoint, not bulk-readable jsonb.
final class ServiceRequestDetailsGuard {

    // Mirrors buildDetails in useRentAgreement.js; a key added there must be added here.
    static final Set<String> RENT_AGREEMENT_KEYS = Set.of("property", "ownerName", "tenants", "rent",
            "deposit", "nrDeposit", "months", "startDate", "regArea", "_state");

    private static final Pattern AADHAAR_IN_KEY = Pattern.compile("adhaa?r");

    private static final Pattern PAN_KEY_WORD = Pattern.compile("pan(no|num|number|card|id)?");

    private static final Set<String> PHONE_KEY_WORDS = Set.of("mobile", "phone");

    private static final Pattern KEY_WORD_BOUNDARY = Pattern.compile(
            "[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=\\d)|(?<=\\d)(?=[A-Za-z])");

    // A UUID's last group can be twelve digits, so UUIDs are cut out before a run is sought.
    private static final Pattern UUID_SHAPE = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    private static final Pattern AADHAAR_RUN = Pattern.compile("(?<!\\d)([2-9]\\d{3})"
            + "[\\s\\u00A0\\u2010-\\u2015./-]{0,3}(\\d{4})[\\s\\u00A0\\u2010-\\u2015./-]{0,3}(\\d{4})(?!\\d)");

    private static final Pattern PAN = Pattern.compile(
            "(?<![A-Z0-9])[A-Z]{3}[PCHFATBLJG][A-Z]\\d{4}[A-Z](?![A-Z0-9])", Pattern.CASE_INSENSITIVE);

    private static final Pattern MOBILE_WITH_COUNTRY_CODE = Pattern.compile("91[6-9]\\d{9}");

    private ServiceRequestDetailsGuard() {
    }

    static void check(String type, Map<String, Object> details) {
        if (details == null || details.isEmpty()) {
            return;
        }
        if (ServiceRequestTypes.RENT_AGREEMENT.equals(type)) {
            for (String key : details.keySet()) {
                if (!RENT_AGREEMENT_KEYS.contains(key)) {
                    throw new BadRequestException("details carries '" + key
                            + "', which a rent agreement does not have; expected only "
                            + RENT_AGREEMENT_KEYS);
                }
            }
            rejectIdentityNumbers(null, withoutPaymentReferences(details));
            return;
        }
        rejectIdentityNumbers(null, details);
    }

    // A 12-digit IMPS/UPI UTR passes the Aadhaar checksum one time in ten, so a well-formed
    // deposit-payment reference is checked for a PAN only.
    private static Map<String, Object> withoutPaymentReferences(Map<String, Object> details) {
        if (!(details.get("_state") instanceof Map<?, ?> state) || !(state.get("terms") instanceof Map<?, ?> terms)
                || !(terms.get("depositPayments") instanceof List<?> rows)) {
            return details;
        }
        List<Object> checked = new ArrayList<>();
        for (Object row : rows) {
            if (!DepositPaymentRules.isPaymentReference(row)) {
                checked.add(row);
                continue;
            }
            Map<Object, Object> copy = new LinkedHashMap<>((Map<?, ?>) row);
            if (PAN.matcher(String.valueOf(copy.remove("ref"))).find()) {
                throw refused("a PAN under 'ref'");
            }
            checked.add(copy);
        }
        Map<Object, Object> nextTerms = new LinkedHashMap<>(terms);
        nextTerms.put("depositPayments", checked);
        Map<Object, Object> nextState = new LinkedHashMap<>(state);
        nextState.put("terms", nextTerms);
        Map<String, Object> next = new LinkedHashMap<>(details);
        next.put("_state", nextState);
        return next;
    }

    private static void rejectIdentityNumbers(String key, Object node) {
        if (node == null || String.valueOf(node).isBlank()) {
            return;
        }
        if (key != null && namesIdentityNumber(key)) {
            throw refused("'" + key + "'");
        }
        if (node instanceof Map<?, ?> map) {
            map.forEach((k, v) -> {
                if (looksLikeIdentityNumber(null, k)) {
                    throw refused("an identity number used as a key");
                }
                rejectIdentityNumbers(String.valueOf(k), v);
            });
        } else if (node instanceof Iterable<?> items) {
            items.forEach(item -> rejectIdentityNumbers(key, item));
        } else if (looksLikeIdentityNumber(key, node)) {
            throw refused("an identity number under '" + key + "'");
        }
    }

    private static boolean looksLikeIdentityNumber(String key, Object value) {
        String text = value instanceof Number number ? String.valueOf(number.longValue()) : String.valueOf(value);
        boolean phoneField = key != null && words(key).anyMatch(PHONE_KEY_WORDS::contains);
        Matcher run = AADHAAR_RUN.matcher(UUID_SHAPE.matcher(asciiDigits(text)).replaceAll(" "));
        while (run.find()) {
            String digits = run.group(1) + run.group(2) + run.group(3);
            if (AadhaarValidator.isAadhaar(digits)
                    && !(phoneField && MOBILE_WITH_COUNTRY_CODE.matcher(digits).matches())) {
                return true;
            }
        }
        return value instanceof String && PAN.matcher(text).find();
    }

    private static String asciiDigits(String text) {
        StringBuilder out = new StringBuilder(text.length());
        text.codePoints().forEach(c -> out.appendCodePoint(Character.isDigit(c) ? '0' + Character.digit(c, 10) : c));
        return out.toString();
    }

    private static boolean namesIdentityNumber(String key) {
        return AADHAAR_IN_KEY.matcher(key.toLowerCase(Locale.ROOT)).find()
                || words(key).anyMatch(word -> PAN_KEY_WORD.matcher(word).matches());
    }

    private static Stream<String> words(String key) {
        return Arrays.stream(KEY_WORD_BOUNDARY.split(key)).map(word -> word.toLowerCase(Locale.ROOT));
    }

    private static BadRequestException refused(String what) {
        return new BadRequestException("details must not carry identity numbers (found " + what
                + "); send them to PUT /service-requests/{id}/identities instead, and identity "
                + "documents to the vault");
    }
}
