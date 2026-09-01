package com.draazy.api.common.trust;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * Proof for the two halves of the mobile kernel: what a masked number looks like, and what counts
 * as a real one.
 *
 * <p>These are unit tests on purpose. The rule they pin is a security rule, and the whole reason
 * this class exists is that the rule had started to fork into per-feature copies — so it needs a
 * test that fails loudly the moment someone edits it, not one buried in an endpoint test that only
 * exercises the happy path.
 */
class MobileMaskTest {

    // ---- mask ----

    @Test
    void masksToTheContractForm() {
        assertThat(MobileMask.mask("9821000123")).isEqualTo("98XXXXX123");
    }

    @Test
    void stripsPunctuationBeforeMasking() {
        assertThat(MobileMask.mask("98210 00123")).isEqualTo("98XXXXX123");
    }

    @Test
    void refusesToHalfMaskSomethingThatIsNotAMobile() {
        // A best-effort partial mask is worse than none: it looks successful while leaking more
        // than intended.
        assertThat(MobileMask.mask("98210")).isNull();
        assertThat(MobileMask.mask("")).isNull();
        assertThat(MobileMask.mask(null)).isNull();
    }

    // ---- normalise ----

    @Test
    void normalisesAPlainMobile() {
        assertThat(MobileMask.normalise("9821000123")).isEqualTo("9821000123");
    }

    @Test
    void normalisesThroughPunctuationAndCountryCode() {
        assertThat(MobileMask.normalise("+91 98210 00123")).isEqualTo("9821000123");
        assertThat(MobileMask.normalise("0091-9821000123")).isEqualTo("9821000123");
        assertThat(MobileMask.normalise("09821000123")).isEqualTo("9821000123");
    }

    /**
     * The defect this method exists to prevent. A masked number strips to {@code 98123} — five
     * digits, short but entirely plausible. A lenient "take the trailing digits" normaliser
     * accepts it as an identity, and any two people sharing a first-two/last-three pattern then
     * collapse onto the same value. This project already shipped and fixed exactly that bug on the
     * client; the server must not reintroduce it.
     */
    @Test
    void rejectsAMaskedNumberRatherThanTreatingItAsAnIdentity() {
        assertThat(MobileMask.normalise("98XXXXX123")).isNull();
        assertThat(MobileMask.normalise("98\u2022\u2022\u2022\u2022\u2022123")).isNull();
    }

    @Test
    void rejectsAnythingThatIsNotAWholeMobile() {
        assertThat(MobileMask.normalise("98210")).isNull();
        assertThat(MobileMask.normalise("")).isNull();
        assertThat(MobileMask.normalise(null)).isNull();
        // Long, but not a country code — a typo, not a prefix. Truncating it would silently
        // store someone else's number.
        assertThat(MobileMask.normalise("129821000123")).isNull();
    }

    /**
     * {@code mask} and {@code normalise} deliberately disagree about a country code, and that is
     * not an oversight. {@code normalise} handles what a <em>user typed</em>, so it tolerates
     * {@code +91}. {@code mask} handles what was <em>read back from the database</em>, which is
     * always already normalised — so anything other than a bare 10 digits reaching it means
     * something upstream skipped normalisation, and returning null is the right way to make that
     * loud. Raw input must therefore be composed: {@code mask(normalise(x))}.
     */
    @Test
    void maskIsStrictAboutCountryCodesBecauseNormaliseAlreadyRanFirst() {
        assertThat(MobileMask.mask("+91 98210 00123")).isNull();
        assertThat(MobileMask.mask(MobileMask.normalise("+91 98210 00123")))
                .isEqualTo("98XXXXX123");
    }
}
