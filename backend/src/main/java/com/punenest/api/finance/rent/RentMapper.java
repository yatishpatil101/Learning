package com.punenest.api.finance.rent;

import java.util.UUID;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

/**
 * Entity→wire mapper for the rent money rail (MapStruct-generated, wired as a Spring bean).
 *
 * <p><strong>Why generated rather than hand-written.</strong> Per {@code api-standards.md} §8.1,
 * trust-shaping stays in source and mechanical mapping is generated. Nothing here is trust-shaped:
 * a rent payment carries no mobile and no counterparty contact, and both parties to a tenancy
 * already have each other's numbers. The one field that <em>looks</em> sensitive —
 * {@code maskedAccount} — is masked in the database, not at mapping time, so there is no visibility
 * rule for a mapper to get wrong.
 *
 * <p>{@code unmappedTargetPolicy = ERROR} so adding a DTO field without mapping it fails the build
 * rather than shipping a silent null. That matters more here than usual: an unmapped
 * {@code platformFee} would read as ₹0 on a receipt.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface RentMapper {

    /**
     * Project a stored payment for the wire.
     *
     * <p>{@code paymentSessionId} is single-use and deliberately never persisted (D167), so there is
     * nothing on the entity to map. {@code RentService.attach} stitches a fresh one onto the create
     * response via {@link RentPaymentDto#withPaymentSessionId(String)}; every other read is null.
     */
    @Mapping(target = "paymentSessionId", ignore = true)
    // MapStruct reads the record's `withPaymentSessionId` copy-method as a fluent setter and so as a
    // second writable target property. It is not one -- it is how RentService.attach stitches the
    // session onto the create response -- and unmappedTargetPolicy = ERROR (rightly) fails the build
    // over anything it cannot account for. Named and ignored rather than weakening the policy.
    @Mapping(target = "withPaymentSessionId", ignore = true)
    RentPaymentDto toDto(RentPayment payment);

    /** Project a stored mandate for the wire. */
    RentMandateDto toDto(RentMandate mandate);

    /**
     * Project a payout account for the wire.
     *
     * <p>There is no {@code accountNumber} on {@link PayoutAccountDto} to map, because the full
     * number is never persisted — see {@link PayoutAccount}.
     */
    PayoutAccountDto toDto(PayoutAccount account);

    /** Opaque-id convention: the wire exposes the UUID as a string. */
    default String map(UUID value) {
        return value == null ? null : value.toString();
    }
}
