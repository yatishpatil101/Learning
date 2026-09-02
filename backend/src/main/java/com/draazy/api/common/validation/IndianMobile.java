package com.draazy.api.common.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * A field carries an Indian mobile number that the platform can canonicalise to its stored 10-digit
 * form — the shared input rule for every mobile the API accepts (tech-debt D23, open-question Q1).
 *
 * <p><strong>Why this is a {@code ConstraintValidator} and not a composed {@code @Pattern}.</strong>
 * The register originally sketched D23 as a bare meta-annotation over {@code @Pattern(Formats.MOBILE)}
 * — the strict {@code ^[6-9][0-9]{9}$}. Q1 then had to reconcile two components that already
 * disagreed: that strict pattern <em>rejects</em> {@code +91 98210 00123}, while
 * {@link com.draazy.api.common.trust.MobileMask#normalise} <em>accepts</em> it and canonicalises to
 * ten digits, "because that is a normal way to type a number" (its own Javadoc). Q1 chose the kinder
 * rule: <strong>tolerate on input, store the canonical form.</strong> A pattern cannot express "valid
 * iff it canonicalises", so the annotation delegates to the one canonicaliser the platform already
 * trusts, rather than inventing a second, looser regex that would drift from it.
 *
 * <p><strong>This validates; it does not normalise.</strong> A {@code ConstraintValidator} may not
 * mutate the value it checks, so accepting {@code +91 98210 00123} here does not by itself make the
 * <em>stored</em> value ten digits. Each service that persists or keys on a mobile calls
 * {@code MobileMask.normalise} once at its edge (see {@code AuthService.login}); this annotation
 * guarantees that call cannot return {@code null}. Storage strictness is still owned by
 * {@link Formats#MOBILE}, which the OpenAPI {@code Mobile} schema documents as the returned shape.
 *
 * <p><strong>Null passes,</strong> per the Bean Validation convention: presence is a separate concern
 * that {@code @NotBlank} / {@code @NotNull} express. Pair this with one of those where the mobile is
 * required.
 */
@Documented
@Constraint(validatedBy = IndianMobileValidator.class)
@Target({java.lang.annotation.ElementType.FIELD, java.lang.annotation.ElementType.PARAMETER,
        java.lang.annotation.ElementType.RECORD_COMPONENT})
@Retention(RetentionPolicy.RUNTIME)
public @interface IndianMobile {

    /** The message deliberately describes the stored shape, not the many tolerated input shapes.
     * Reuses {@link Formats#MOBILE_MESSAGE} so the one rule still has the one message (D25). */
    String message() default Formats.MOBILE_MESSAGE;

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
