package com.draazy.api.catalog.property;

/**
 * Normalises an electricity meter number into a comparison key (V115).
 *
 * <p><strong>What problem this solves.</strong> {@code V79} says a meter number, "unlike an
 * address, has one spelling". That is true of the meter and false of the number: the same MSEDCL
 * consumer number reaches this platform as {@code "170012345678"}, {@code "1700 1234 5678"} and
 * {@code "170-0123-45678"}, because it is copied off a bill that prints it in groups and typed by a
 * human who groups it their own way. The duplicate probe compares with {@code =}, so those three
 * were three different meters — and the meter arm is the arm that exists precisely because it is
 * supposed to be the certain one. An owner who typed their number with spaces in March and without
 * in April got no collision at all, and neither did two owners fighting over one flat.
 *
 * <p><strong>Why a derived column and not normalising in place.</strong> The raw
 * {@link Property#getElectricityMeterNo()} stays exactly as the owner typed it, because they are
 * shown it back and they will check it against a bill that has the grouping printed on it; a value
 * that silently reformats itself between submit and re-read reads as data loss to the one person
 * who can tell us it is wrong. So this mirrors what {@link AddressKey} already does for
 * {@code address}: raw column for the human, derived key for the comparison, one derivation on the
 * server, never accepted from a client — a client that chooses its own key chooses which listings
 * it collides with.
 *
 * <p><strong>Why digits only.</strong> No MSEDCL consumer number carries meaning in its separators;
 * every non-digit in one is presentation. That makes this normalisation total and reversible-free in
 * a way {@link AddressKey}'s is not, which is also why, unlike the address key, this one <em>is</em>
 * expressible in SQL — the V115 backfill runs the same rule as a {@code regexp_replace}, and the two
 * are kept honest by both being stated as "strip everything that is not a digit" rather than by a
 * shared function.
 *
 * <p><strong>Why short numbers produce no key.</strong> A field this optional collects placeholders
 * — {@code "0"}, {@code "NA"}, {@code "1234"} — and under exact equality every owner who typed the
 * same placeholder collides with every other. That is a moderation queue full of manufactured
 * suspicion against honest owners, which is the specific cost {@link AddressKey} refuses to pay for
 * a loose key. Six digits is the floor the client has always used, so this is one rule in two places
 * rather than a new one.
 */
public final class MeterKey {

    /** Below this, the value is a placeholder rather than a meter. See the class note. */
    private static final int MIN_DIGITS = 6;

    private MeterKey() {
    }

    /**
     * Build the comparison key for one meter number.
     *
     * @param meterNo the number as the owner typed it, nullable
     * @return the digits of {@code meterNo}, or {@code null} when it is absent or carries fewer than
     *     six of them — which the duplicate probe reads as "no signal", the right answer for a field
     *     the owner left blank and for one they filled with a placeholder
     */
    public static String of(String meterNo) {
        if (meterNo == null) {
            return null;
        }
        String digits = meterNo.replaceAll("\\D", "");
        return digits.length() < MIN_DIGITS ? null : digits;
    }
}
