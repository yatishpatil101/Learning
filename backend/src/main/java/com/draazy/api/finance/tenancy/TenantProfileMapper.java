package com.draazy.api.finance.tenancy;

import org.mapstruct.BeanMapping;
import org.mapstruct.Mapper;
import org.mapstruct.MappingTarget;
import org.mapstruct.ReportingPolicy;

/**
 * Request→entity mapper for the tenant profile (api-standards §8.1).
 *
 * <p>Separate from {@link TenancyMapper}, which is a hand-written static class because its whole job
 * is trust-shaping — masking a counterparty's mobile by visibility. This one is the opposite kind of
 * work: seven fields copied name-for-name, five of them adjacent {@code String}s
 * ({@code name}, {@code occupation}, {@code occupants}, {@code priorLandlord}, {@code about}) where
 * transposing two compiles cleanly and files a tenant's landlord reference as their occupation.
 *
 * <p><strong>{@code ignoreByDefault = true}</strong> keeps {@code verified} and {@code score} out of
 * reach. {@code TenantProfileUpdateRequest} already omits them — its Javadoc explains that a tenant
 * who could send {@code score: 100} would be setting the number owners use to decide whether to let
 * them into a flat — so this is the second lock rather than the first. It matters because the record
 * could gain a field later; the allowlist means that alone would not make it settable.
 *
 * <p>No null handling: {@code PUT} replaces, so an absent field clears the stored value. That is the
 * documented semantic, and MapStruct's default assignment reproduces it exactly.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface TenantProfileMapper {

    @BeanMapping(ignoreByDefault = true)
    @org.mapstruct.Mapping(target = "name", source = "name")
    @org.mapstruct.Mapping(target = "occupation", source = "occupation")
    @org.mapstruct.Mapping(target = "income", source = "income")
    @org.mapstruct.Mapping(target = "occupants", source = "occupants")
    @org.mapstruct.Mapping(target = "moveIn", source = "moveIn")
    @org.mapstruct.Mapping(target = "priorLandlord", source = "priorLandlord")
    @org.mapstruct.Mapping(target = "about", source = "about")
    void applyTo(TenantProfileUpdateRequest body, @MappingTarget TenantProfile profile);
}
