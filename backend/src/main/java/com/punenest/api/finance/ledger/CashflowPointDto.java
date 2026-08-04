package com.punenest.api.finance.ledger;

/**
 * One month of the cashflow series (contract {@code CashflowPoint}).
 *
 * <p><strong>Self-describing, not positional.</strong> The mock returns three parallel arrays
 * ({@code labels}, {@code incomeData}, {@code expenseData}) paired by index; the contract returns a
 * list of labelled points and the contract wins. Parallel arrays are a shape where a single dropped
 * element silently misaligns every subsequent month — the chart still renders, it is just wrong,
 * and nothing anywhere reports an error. The frontend adapter re-splits these into the arrays its
 * chart library wants; that is a display concern and belongs on the display side.
 *
 * <p>Months with no activity are present with zeros. A gap and a zero are different pictures, and
 * only the request knows which months were asked for.
 *
 * @param month   {@code yyyy-MM}
 * @param income  received that month, whole INR
 * @param expense spent that month, whole INR
 * @param net     {@code income - expense}; may be negative
 */
public record CashflowPointDto(
        String month,
        Long income,
        Long expense,
        Long net) {
}
