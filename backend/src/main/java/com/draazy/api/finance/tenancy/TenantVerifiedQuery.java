package com.draazy.api.finance.tenancy;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * The batch question behind {@code POST /tenant-profiles/verified} (contract
 * {@code tenantsVerified}, tech-debt D114).
 *
 * <p><strong>Why a body rather than a query string.</strong> The input is a list of mobile numbers,
 * and a mobile number is the exact identifier the contact gate exists to protect. Query strings are
 * written to access logs, kept by proxies and caches, and survive in browser history and
 * {@code Referer} headers; a request body is none of those things. So this is a {@code POST}
 * despite being a read, and the method is chosen for where the parameters end up rather than for
 * REST tidiness.
 *
 * <p><strong>Entries are tolerated, not validated.</strong> There is deliberately no
 * {@code @IndianMobile} on the elements. This backs a badge rendered beside every row of a list, so
 * one malformed entry must cost that row its badge and nothing else — failing the whole request
 * with a 400 would blank the badge on every other row too, which is a worse answer to a smaller
 * problem. A number that does not normalise simply answers {@code false}, exactly as
 * {@code GET /tenant-profiles/{mobile}} answers 404 rather than 400 for a malformed path.
 *
 * <p>The <em>size</em> of the list is bounded, and that bound is not negotiable — see
 * {@link TenantProfileService#MAX_VERIFIED_BATCH}. An unbounded list is an amplification primitive:
 * one cheap request buying an arbitrary amount of database work. The cap is enforced in the service
 * rather than by {@code @Size} so the refusal can name the limit, which is what lets a client fix
 * itself by paging instead of guessing.
 *
 * @param mobiles the numbers to ask about, as the caller has them
 */
public record TenantVerifiedQuery(@NotNull List<String> mobiles) {
}
