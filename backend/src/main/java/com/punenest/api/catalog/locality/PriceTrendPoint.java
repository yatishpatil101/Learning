package com.punenest.api.catalog.locality;

import java.math.BigDecimal;

/**
 * One month of a locality's price history.
 *
 * <p>Doubles as the jsonb element type of {@code localities.price_trends} and the wire shape of
 * {@code LocalityDetail.priceTrends} — the contract and the column agree exactly, so a second type
 * to translate between them would translate nothing.
 *
 * @param month   the period label as authored, e.g. {@code 2025-03}
 * @param rentPsf average asking rent per sq ft that month
 * @param buyPsf  average asking sale price per sq ft that month
 */
public record PriceTrendPoint(String month, BigDecimal rentPsf, BigDecimal buyPsf) {
}
