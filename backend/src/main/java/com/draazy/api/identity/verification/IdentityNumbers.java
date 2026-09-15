package com.draazy.api.identity.verification;

import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Canonical form and format check for the three document numbers; dedup requires the same card to
 * always hash the same way, so every number is uppercased with spaces and hyphens stripped.
 */
public final class IdentityNumbers {

    private IdentityNumbers() {
    }

    private static final Pattern AADHAAR = Pattern.compile("^[2-9]\\d{11}$");
    private static final Pattern PAN = Pattern.compile("^[A-Z]{5}\\d{4}[A-Z]$");
    private static final Pattern DRIVING_LICENCE = Pattern.compile("^[A-Z]{2}\\d{13}$");

    // Verhoeff multiplication, permutation and inverse tables (UIDAI's published check digit).
    private static final int[][] D = {
        {0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
        {1, 2, 3, 4, 0, 6, 7, 8, 9, 5},
        {2, 3, 4, 0, 1, 7, 8, 9, 5, 6},
        {3, 4, 0, 1, 2, 8, 9, 5, 6, 7},
        {4, 0, 1, 2, 3, 9, 5, 6, 7, 8},
        {5, 9, 8, 7, 6, 0, 4, 3, 2, 1},
        {6, 5, 9, 8, 7, 1, 0, 4, 3, 2},
        {7, 6, 5, 9, 8, 2, 1, 0, 4, 3},
        {8, 7, 6, 5, 9, 3, 2, 1, 0, 4},
        {9, 8, 7, 6, 5, 4, 3, 2, 1, 0}};
    private static final int[][] P = {
        {0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
        {1, 5, 7, 6, 2, 8, 3, 0, 9, 4},
        {5, 8, 0, 3, 7, 9, 6, 1, 4, 2},
        {8, 9, 1, 6, 0, 4, 3, 5, 2, 7},
        {9, 4, 5, 3, 1, 2, 6, 8, 7, 0},
        {4, 2, 8, 6, 5, 7, 3, 9, 0, 1},
        {2, 7, 9, 3, 8, 0, 6, 4, 1, 5},
        {7, 0, 4, 6, 9, 1, 3, 2, 5, 8}};

    /** Uppercase with every space and hyphen removed; {@code null}/blank becomes empty. */
    public static String normalise(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.replaceAll("[\\s-]", "").toUpperCase(Locale.ROOT);
    }

    /** Canonical number if well-formed for {@code docType}, else empty (submit: no-claim; approve: 422). */
    public static Optional<String> canonical(String docType, String raw) {
        String n = normalise(raw);
        boolean ok = switch (docType) {
            case IdentityDocTypes.AADHAAR -> AADHAAR.matcher(n).matches() && verhoeffValid(n);
            case IdentityDocTypes.PAN -> PAN.matcher(n).matches();
            case IdentityDocTypes.DRIVING_LICENCE -> DRIVING_LICENCE.matcher(n).matches();
            default -> false;
        };
        return ok ? Optional.of(n) : Optional.empty();
    }

    /** The trailing four characters — all the row keeps of the number once the hash is set. */
    public static String last4(String canonical) {
        return canonical.length() <= 4 ? canonical : canonical.substring(canonical.length() - 4);
    }

    static boolean verhoeffValid(String digits) {
        int c = 0;
        int len = digits.length();
        for (int i = 0; i < len; i++) {
            int digit = digits.charAt(len - 1 - i) - '0';
            c = D[c][P[i % 8][digit]];
        }
        return c == 0;
    }
}
