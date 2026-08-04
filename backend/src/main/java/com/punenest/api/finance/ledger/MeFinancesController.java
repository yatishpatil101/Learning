package com.punenest.api.finance.ledger;

import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The owner's property finance ledger at {@code /me/finances/{propId}} — transactions, ownership
 * basis, and the three aggregates derived from them.
 *
 * <p>No {@code @PreAuthorize} role guard: the spec carries no {@code x-roles} on any of these
 * operations, and inventing one would restrict a surface the contract says every authenticated
 * owner may use. Authentication plus strict owner-scoping in {@link FinanceService} is the gate,
 * and a caller who is not the owner gets 404 rather than 403.
 */
@RestController
public class MeFinancesController {

    private final FinanceService financeService;

    public MeFinancesController(FinanceService financeService) {
        this.financeService = financeService;
    }

    /**
     * {@code GET /me/finances/{propId}/transactions} (contract {@code listTransactions}).
     *
     * <p>Sort stripped via {@link Pageables#unsorted(Pageable)}: the contract offers no
     * {@code sort} here and the query fixes its own order (newest first).
     */
    @GetMapping(Routes.Finances.TRANSACTIONS)
    public PageResponse<TransactionDto> listTransactions(@CurrentUser AuthPrincipal principal,
                                                 @PathVariable("propId") String propId,
                                                 @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                financeService.listTransactions(
                        principal.userId(), parseUuid(propId), Pageables.unsorted(pageable)),
                dto -> dto);
    }

    /** {@code POST /me/finances/{propId}/transactions} (contract {@code addTransaction}) — 201. */
    @PostMapping(Routes.Finances.TRANSACTIONS)
    @ResponseStatus(HttpStatus.CREATED)
    public TransactionDto addTransaction(@CurrentUser AuthPrincipal principal,
                                         @PathVariable("propId") String propId,
                                         @Valid @RequestBody TransactionCreateRequest body) {
        return financeService.addTransaction(principal.userId(), parseUuid(propId), body);
    }

    /**
     * {@code PATCH /me/finances/{propId}/transactions/{txnId}} (contract
     * {@code updateTransaction}) — a genuine partial update; absent fields are left alone.
     */
    @PatchMapping(Routes.Finances.TRANSACTION_BY_ID)
    public TransactionDto updateTransaction(@CurrentUser AuthPrincipal principal,
                                            @PathVariable("propId") String propId,
                                            @PathVariable("txnId") String txnId,
                                            @Valid @RequestBody TransactionUpdateRequest body) {
        return financeService.updateTransaction(
                principal.userId(), parseUuid(propId), parseTxnUuid(txnId), body);
    }

    /**
     * {@code DELETE /me/finances/{propId}/transactions/{txnId}} (contract
     * {@code deleteTransaction}) — soft-deletes the row. Returns 204.
     */
    @DeleteMapping(Routes.Finances.TRANSACTION_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteTransaction(@CurrentUser AuthPrincipal principal,
                                  @PathVariable("propId") String propId,
                                  @PathVariable("txnId") String txnId) {
        financeService.deleteTransaction(
                principal.userId(), parseUuid(propId), parseTxnUuid(txnId));
    }

    /** {@code GET /me/finances/{propId}/basis} (contract {@code getBasis}). */
    @GetMapping(Routes.Finances.BASIS)
    public OwnershipBasisDto getBasis(@CurrentUser AuthPrincipal principal,
                                      @PathVariable("propId") String propId) {
        return financeService.getBasis(principal.userId(), parseUuid(propId));
    }

    /** {@code PUT /me/finances/{propId}/basis} (contract {@code setBasis}) — upsert. */
    @PutMapping(Routes.Finances.BASIS)
    public OwnershipBasisDto setBasis(@CurrentUser AuthPrincipal principal,
                                      @PathVariable("propId") String propId,
                                      @Valid @RequestBody OwnershipBasisDto body) {
        return financeService.setBasis(principal.userId(), parseUuid(propId), body);
    }

    /** {@code GET /me/finances/{propId}/summary} (contract {@code financeSummary}). */
    @GetMapping(Routes.Finances.SUMMARY)
    public FinanceSummaryDto summary(@CurrentUser AuthPrincipal principal,
                                     @PathVariable("propId") String propId,
                                     @RequestParam(value = "period", required = false)
                                     String period) {
        return financeService.summary(principal.userId(), parseUuid(propId), period);
    }

    /** {@code GET /me/finances/{propId}/cashflow} (contract {@code financeCashflow}). */
    @GetMapping(Routes.Finances.CASHFLOW)
    public List<CashflowPointDto> cashflow(@CurrentUser AuthPrincipal principal,
                                           @PathVariable("propId") String propId,
                                           @RequestParam(value = "months", required = false)
                                           Integer months) {
        return financeService.cashflow(principal.userId(), parseUuid(propId), months);
    }

    /** {@code GET /me/finances/{propId}/dues} (contract {@code financeDues}). */
    @GetMapping(Routes.Finances.DUES)
    public List<DueDto> dues(@CurrentUser AuthPrincipal principal,
                             @PathVariable("propId") String propId) {
        return financeService.dues(principal.userId(), parseUuid(propId));
    }

    /**
     * A malformed property id is 404, not 400. The caller asked for a property that cannot exist,
     * and answering "your id is the wrong shape" versus "no such property" tells a prober which
     * ids are worth trying.
     */
    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElseThrow(() -> NotFoundException.of("Property"));
    }

    /** Same rule for a transaction id, with the message the caller would have got anyway. */
    private static UUID parseTxnUuid(String token) {
        return Ids.parseUuid(token)
                .orElseThrow(() -> NotFoundException.of("Transaction"));
    }
}
