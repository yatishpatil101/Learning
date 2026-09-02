/**
 * Moderation — platform safety: listing review, user and KYC verification, the reports/abuse queue
 * and review moderation. The one context that legitimately reaches into everything.
 *
 * <p><strong>Boundary (rank 6, {@code ArchitectureBoundaryTest} LAYER).</strong> Ranked near the
 * top so its reads are all downward and legal: taking content down means touching {@code catalog}
 * (properties), {@code identity} (users) and {@code engagement} (reviews), and the abuse queue can
 * point at any of them. It may not import {@code admin} (7), and nothing below may import it — a
 * listing can never decide it has been moderated.
 */
package com.draazy.api.moderation;
