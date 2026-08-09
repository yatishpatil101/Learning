package com.punenest.api.common.validation;

import com.punenest.api.common.trust.MobileMask;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import java.util.regex.Pattern;

/**
 * Backs {@link IndianMobile}: a value is valid iff {@link MobileMask#normalise} can reduce it to ten
 * digits <em>and</em> those digits match the stored {@link Formats#MOBILE} shape.
 *
 * <p><strong>Both checks, not just the first.</strong> {@code normalise} fails closed on length only
 * — it accepts any ten digits, including a leading {@code 1}–{@code 5} that no Indian mobile starts
 * with. The stored invariant ({@code ^[6-9][0-9]{9}$}, mirrored by column CHECK constraints) is
 * stricter on that first digit. Validating the <em>normalised</em> form against {@link Formats#MOBILE}
 * is what keeps input tolerance from admitting a number the database would then reject with a 500:
 * whatever passes here is exactly what a service will persist after it normalises.
 *
 * <p>Delegating to {@code normalise} rather than re-spelling a regex is still the point — one
 * canonicaliser — but the leading-digit rule lives with the stored shape, where it belongs.
 *
 * <p>Null is valid; presence is {@code @NotBlank}'s job, not this validator's.
 */
public final class IndianMobileValidator implements ConstraintValidator<IndianMobile, String> {

    private static final Pattern STORED = Pattern.compile(Formats.MOBILE);

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        String normalised = MobileMask.normalise(value);
        return normalised != null && STORED.matcher(normalised).matches();
    }
}
