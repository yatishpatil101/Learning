package com.draazy.api.finance.ledger;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
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

/** No {@code @PreAuthorize}: the spec has no {@code x-roles} here,
 * so strict owner-scoping in {@link FinanceService} is the gate (404, not 403). */
@RestController
public class MeFinancesController {

    private final FinanceService financeService;

    public MeFinancesController(FinanceService financeService) {
        this.financeService = financeService;
    }

    /** Sort stripped via {@link Pageables#unsorted(Pageable)}: the contract offers no {@code sort}. */
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

    @PatchMapping(Routes.Finances.TRANSACTION_BY_ID)
    public TransactionDto updateTransaction(@CurrentUser AuthPrincipal principal,
                                            @PathVariable("propId") String propId,
                                            @PathVariable("txnId") String txnId,
                                            @Valid @RequestBody TransactionUpdateRequest body) {
        return financeService.updateTransaction(
                principal.userId(), parseUuid(propId), parseTxnUuid(txnId), body);
    }

    @DeleteMapping(Routes.Finances.TRANSACTION_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteTransaction(@CurrentUser AuthPrincipal principal,
                                  @PathVariable("propId") String propId,
                                  @PathVariable("txnId") String txnId) {
        financeService.deleteTransaction(
                principal.userId(), parseUuid(propId), parseTxnUuid(txnId));
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

    /** {@code months} sizes the cashflow series (default 12). */
    @GetMapping(Routes.Finances.OVERVIEW)
    public FinanceOverviewDto overview(@CurrentUser AuthPrincipal principal,
                                       @PathVariable("propId") String propId,
                                       @RequestParam(value = "months", required = false)
                                       Integer months) {
        return financeService.overview(principal.userId(), parseUuid(propId), months);
    }

    /** A malformed property id is 404, not 400, as telling the shape from absence would show a prober which ids are worth trying. */
    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElseThrow(() -> NotFoundException.of("Property"));
    }

    /** Same rule for a transaction id, with the message the caller would have got anyway. */
    private static UUID parseTxnUuid(String token) {
        return Ids.parseUuid(token)
                .orElseThrow(() -> NotFoundException.of("Transaction"));
    }
}
