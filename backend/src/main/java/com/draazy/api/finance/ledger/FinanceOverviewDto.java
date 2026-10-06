package com.draazy.api.finance.ledger;

import java.util.List;

/** {@code basis} is {@code null} when the owner has not recorded purchase/valuation figures. */
public record FinanceOverviewDto(
        OwnershipBasisDto basis,
        List<DueDto> dues,
        List<CashflowPointDto> cashflow) {
}
