/**
 * Admin &amp; Analytics — the back office: KPIs and analytics, platform settings, the audit surface
 * and society leads. Reports on the whole platform.
 *
 * <p><strong>Boundary (rank 7, {@code ArchitectureBoundaryTest} LAYER).</strong> Ranked highest so
 * any read it performs is downward and legal, yet in practice it has <em>no outgoing edges at all</em>:
 * it reaches the tables through native SQL ({@code AdminMetricsRepository}) rather than through other
 * contexts' repositories. Nothing below may import it. The rank exists to keep it that way — if a
 * context repository is ever injected here, the read stays legal instead of silently escaping the
 * guardrail.
 */
package com.punenest.api.admin;
