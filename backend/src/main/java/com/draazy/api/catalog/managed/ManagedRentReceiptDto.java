package com.draazy.api.catalog.managed;

import java.time.Instant;

/**
 * Read shape for one manual rent receipt (contract {@code ManagedRentReceipt}).
 *
 * <p>Every field but {@code rentMonth} is the snapshot the server took from the owned property when
 * the owner recorded the month — the client sends none of them and must not re-derive them. The PDF
 * the Owner Hub generates is built from exactly this object, so what a tenant is handed and what the
 * server can reproduce years later are the same document.
 *
 * <p>{@code id} is the durable receipt id and doubles as the receipt's reference number. It is the
 * one identifier that survives a device change, which is the whole point of moving the ledger off
 * {@code localStorage}: the old client minted {@code 'RCPT' + Date.now()} at download time, so
 * re-downloading the same month produced a different reference every time.
 *
 * @param id         server-generated receipt id, stable for the life of the row
 * @param rentMonth  {@code YYYY-MM}, the month the rent was for
 * @param amount     rupees, as the property's monthly rent stood when the month was recorded
 * @param tenantName the tenant named on the property at that moment
 * @param landlordName the owner's name at that moment
 * @param propertyAddress "society, locality, Pune" as it stood at that moment
 * @param createdAt  the receipt date — when the owner asserted the rent had arrived
 */
public record ManagedRentReceiptDto(
        String id,
        String rentMonth,
        long amount,
        String tenantName,
        String landlordName,
        String propertyAddress,
        Instant createdAt) {
}
