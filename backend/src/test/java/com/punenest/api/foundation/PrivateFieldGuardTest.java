package com.punenest.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.catalog.property.PropertyMapper;
import com.punenest.api.catalog.property.PropertyResponse;
import com.punenest.api.common.trust.PrivateFieldVisibility;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Every route that can produce a {@link PropertyResponse} must decide, explicitly, whether the
 * caller may see the owner's private fields.
 *
 * <p><strong>The hazard this closes.</strong> {@code Property.electricityMeterNo} and
 * {@code PropertyResponse.electricityMeterNo} are name-identical, so MapStruct will happily copy one
 * to the other with no annotation, no warning and no compile error. The same is true of
 * {@code address}, which carries the flat number so the duplicate probe can tell one unit from the
 * one next door. Today exactly one mapper method
 * produces a {@code PropertyResponse}, and it is gated on a {@link PrivateFieldVisibility} the
 * caller must pass by name — {@code unmappedTargetPolicy = ERROR} makes forgetting the field
 * impossible, but it does nothing at all about a <em>second</em> method that maps it by default.
 * That method would leak a live utility account number and a doorway to the public detail route,
 * and every existing test would stay green, because there would be nothing wrong with the old
 * method.
 *
 * <p><strong>Why a reflection test and not ArchUnit.</strong> For the reason
 * {@link ArchitectureBoundaryTest} gives at length: the dependency is not resolvable here and the
 * rule is three lines. Reflection is also exact where a source-text regex would be approximate —
 * this asks the compiled signature, so it cannot be fooled by formatting or by a fully-qualified
 * inline type.
 *
 * <p><strong>Why the signature and not the output.</strong> {@code ListingNoticesTest} already
 * asserts that the public route omits the number, which is the property that actually matters. This
 * is the generalisation of it: that assertion covers the three call sites that exist, and this one
 * covers the method that does not exist yet.
 */
@DisplayName("Trust — private listing fields cannot be mapped by accident")
class PrivateFieldGuardTest {

    @Test
    @DisplayName("every PropertyMapper method returning a PropertyResponse takes a visibility")
    void noMapperMethodCanProduceAResponseWithoutDecidingOnPrivateFields() {
        List<Method> producers = Arrays.stream(PropertyMapper.class.getMethods())
                .filter(method -> PropertyResponse.class.equals(method.getReturnType()))
                .toList();

        // If this is ever zero the assertion below passes vacuously, which would be the quietest
        // possible way for this guard to stop guarding anything.
        assertThat(producers)
                .describedAs("PropertyMapper no longer produces PropertyResponse — has the mapper"
                        + " moved? This guard is now inert and must follow it.")
                .isNotEmpty();

        assertThat(producers).allSatisfy(method -> assertThat(method.getParameterTypes())
                .describedAs("%s returns a PropertyResponse without taking a"
                        + " PrivateFieldVisibility, so MapStruct will copy electricityMeterNo and"
                        + " address by name and the caller has no way to say no. Add the @Context"
                        + " parameter and the guarding @Mapping expressions, as toResponse does.",
                        method.getName())
                .contains(PrivateFieldVisibility.class));
    }
}
