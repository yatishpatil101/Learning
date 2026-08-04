package com.punenest.api.catalog.fee;

import org.mapstruct.Mapper;
import org.mapstruct.ReportingPolicy;

/**
 * {@link PlatformFee} to the contract's {@code Fees} record.
 *
 * <p>Every field name matches, so MapStruct generates the whole mapper; there is no trust carve-out
 * here because nothing in a published fee table is private. {@code unmappedTargetPolicy = ERROR}
 * means adding a field to {@link FeeResponse} without a source breaks the build rather than
 * shipping a silent {@code null}.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface FeeMapper {

    FeeResponse toResponse(PlatformFee fee);
}
