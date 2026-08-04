package com.punenest.api.identity.kyc;

/**
 * Masking for the two identifiers owner KYC handles.
 *
 * <p><strong>The raw values are never stored and never returned.</strong> PAN and Aadhaar are the
 * two strings that turn a data leak into an identity-theft incident, and PuneNest has no reason to
 * hold them: the verification verdict comes from the KYC provider, and everything the product does
 * afterwards ("is this owner verified", "show me the last four digits") is satisfied by the mask.
 * So the mask is produced at the edge, on the way in, and the full value never reaches a column.
 *
 * <p>The formats match the contract's examples exactly: {@code XXXXX1234X} keeps PAN's trailing
 * check letter, which is what makes two masked PANs distinguishable at a glance, and
 * {@code XXXX XXXX 1234} is the standard Aadhaar rendering.
 */
public final class KycMasks {

    private KycMasks() {
    }

    /** {@code ABCDE1234F → XXXXX1234F}. */
    public static String maskPan(String pan) {
        if (pan == null || pan.length() != 10) {
            return null;
        }
        return "XXXXX" + pan.substring(5).toUpperCase(java.util.Locale.ROOT);
    }

    /** {@code 123412341234 → XXXX XXXX 1234}. */
    public static String maskAadhaar(String aadhaar) {
        if (aadhaar == null || aadhaar.length() != 12) {
            return null;
        }
        return "XXXX XXXX " + aadhaar.substring(8);
    }
}
