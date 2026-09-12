package com.draazy.api.finance.ledger;

import java.time.LocalDate;
import java.util.UUID;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.ReportingPolicy;

/**
 * Entity→wire mapper for the finance ledger (MapStruct-generated, wired as a Spring bean).
 *
 * <p><strong>Why generated here, when {@code DealMapper} is hand-written.</strong> The rule in
 * {@code api-standards.md} §8.1 is that trust-shaping stays in source and mechanical mapping is
 * generated. Nothing in this feature is trust-shaped: a ledger is one owner's private record of
 * their own property, read only by that owner, and it contains no mobile, no counterparty and no
 * contact detail — there is nothing to mask. Contrast the deals mappers, where a mobile's
 * visibility depends on the viewer and must stay reviewable.
 *
 * <p>{@code unmappedTargetPolicy = ERROR} so that adding a field to a DTO without mapping it fails
 * the build rather than shipping a silent null.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface FinanceMapper {

    /** Project a stored ledger row for the wire. */
    TransactionDto toDto(Transaction transaction);

    /**
     * Project a recurring row together with its computed next occurrence.
     *
     * <p>{@code nextDue} and {@code daysUntil} are passed in rather than derived here: they depend
     * on today's date, and a mapper that reads the clock is a mapper that cannot be tested without
     * one.
     */
    @Mapping(target = "nextDue", source = "nextDue")
    @Mapping(target = "daysUntil", source = "daysUntil")
    DueDto toDueDto(Transaction transaction, LocalDate nextDue, long daysUntil);

    /** Project the ownership basis for the wire. */
    OwnershipBasisDto toDto(OwnershipBasis basis);

    /** Opaque-id convention: the wire exposes the UUID as a string. */
    default String map(UUID value) {
        return value == null ? null : value.toString();
    }
}
