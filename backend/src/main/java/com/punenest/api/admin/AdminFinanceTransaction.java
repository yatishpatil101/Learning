package com.punenest.api.admin;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Contract schema {@code AdminFinanceTransaction} — one movement of money the platform can evidence.
 *
 * <p><strong>What is deliberately not a row here.</strong> A closed deal and a service quote are
 * commercial events with no receipt behind them: no money reached the platform, so no bank statement
 * will ever agree with them. The mock this replaced listed both, gave each a fabricated status by
 * rotating a hardcoded array, and negated the amount whenever that rotation happened to land on
 * "refunded" — so the ledger's most authoritative-looking column was the one carrying the least
 * information. A ledger that cannot be reconciled is worse than a short one.
 *
 * @param id the source row's identifier. Not synthesised and not prefixed: it addresses a real row
 *     in {@code subscriptions} or {@code boosts}, which is what makes a
 *     figure on this screen traceable to the record that produced it.
 * @param date when the money moved, on the Indian calendar. For an unsettled row this is when it
 *     was billed or begun — the row is on the ledger because it is expected, and a null date would
 *     sort it out of the view that exists to chase it.
 * @param party the person on the other side of the transaction. A name, never a mobile number:
 *     {@code /admin/enquiries} exists for the case where an operator needs to reach somebody, and
 *     it audits the reveal. A finance ledger has no reason to carry contact details at all.
 * @param kind {@code subscription} or {@code featured}. The source, not the
 *     product name — a display label belongs to the console, which already translates it.
 * @param amount <strong>the platform's share, in whole rupees</strong>. Never negative: there is no
 *     refund path, so a negative amount could only be a fabrication.
 * @param status settlement, derived: {@code paid}, {@code pending} or {@code failed}. The two
 *     source tables speak unrelated status vocabularies and neither is about
 *     settlement — a {@code cancelled} subscription was still paid for, an {@code expired} boost
 *     was still bought.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AdminFinanceTransaction(
        UUID id,
        LocalDate date,
        String party,
        String kind,
        long amount,
        String status) {
}

