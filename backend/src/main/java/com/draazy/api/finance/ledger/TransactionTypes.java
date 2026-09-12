package com.draazy.api.finance.ledger;

/**
 * The transaction type vocabulary — the two values {@code transactions.type} may physically hold.
 *
 * <p>{@code String} constants, not an {@code enum}, per {@code api-standards.md} §7.1. Both values
 * are traced to:
 * <ul>
 *   <li>V6: {@code CHECK (type IN ('income','expense'))}</li>
 *   <li>OpenAPI: {@code Transaction.type} / {@code TransactionCreate.type} enum</li>
 * </ul>
 *
 * <p>The sign convention lives here rather than in the aggregation code: amounts are stored
 * <strong>unsigned</strong> and the type decides their direction. Storing a negative amount for an
 * expense would give the same fact two representations — an expense of 5,000 and an income of
 * −5,000 — and any query that forgot to check both would quietly produce a different total.
 */
public final class TransactionTypes {

    private TransactionTypes() {
    }

    /** Money received: rent, deposit, anything the owner was paid. */
    public static final String INCOME = "income";

    /** Money spent: maintenance, tax, EMI, repairs. */
    public static final String EXPENSE = "expense";

    /** Whether {@code value} is one of the two stored types. */
    public static boolean isValid(String value) {
        return INCOME.equals(value) || EXPENSE.equals(value);
    }
}
