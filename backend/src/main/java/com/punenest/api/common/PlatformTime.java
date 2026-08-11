package com.punenest.api.common;

import java.time.ZoneId;

/**
 * The one timezone this platform reckons dates in — tech debt D174.
 *
 * <p><strong>Why a constant and not the JVM default.</strong> {@code LocalDate.now()} reads
 * {@code TimeZone.getDefault()}, which is a property of whichever host the process happens to be
 * running on: a laptop in Pune, a container image that ships UTC, a managed runtime in whatever
 * region was cheapest that quarter. Every date this product computes is read by an Indian owner
 * against an Indian bank statement or an Indian tax return, so the answer must not depend on where
 * the process was scheduled. On a UTC host the first 5.5 hours of every IST day (00:00–05:29 IST)
 * are still yesterday to the JVM, which is enough to push the last day of a month into the previous
 * month's rollup and to mis-bucket 1 April, the boundary of the Indian financial year.
 *
 * <p><strong>Scope of this class today.</strong> It is now the only spelling of the zone in the
 * application (tech debt D179 closed the three copies that used to sit in
 * {@code SubscriptionService}, {@code PaymentWebhookController} and {@code AdminMetricsRepository}).
 * Two of those keep a locally named alias — {@code TERM_ZONE} and {@code SETTLEMENT_ZONE} — so the
 * paragraph explaining <em>why that particular code needs a fixed zone</em> stays next to the code;
 * both are assignments from this constant, not second definitions of it. The third is
 * {@code AdminMetricsRepository}, which needs the zone as a SQL string and derives it with
 * {@link ZoneId#getId()} rather than writing the region out again.
 *
 * <p><strong>How to read the current date.</strong> Two shapes are correct, and both apply the zone
 * at the use site rather than to a stored field:
 * <ul>
 *   <li>{@code LocalDate.now(PlatformTime.IST)} — everywhere the date is simply read;</li>
 *   <li>{@code LocalDate.now(clock.withZone(PlatformTime.IST))} — where a test needs to pin the
 *       instant, over a zone-agnostic {@code Clock} field the test can replace. See
 *       {@code FinanceService} and {@code RentService}. The second form is the first with the
 *       instant source made explicit; it is not a rival idiom, and it is worth the extra field only
 *       where a fixed-instant test actually exists.</li>
 * </ul>
 * A bare {@code LocalDate.now()} is always a bug in this codebase.
 *
 * <p><strong>This is a display/reckoning zone, not a storage zone.</strong> Instants are still
 * stored and compared in UTC. What belongs here is the question "which calendar day is it for the
 * user", which is the only question a fixed zone can answer correctly.
 */
public final class PlatformTime {

    /**
     * India Standard Time, the calendar every date this platform shows or buckets is reckoned in.
     *
     * <p>Named as a region rather than as the {@code +05:30} offset deliberately: an offset is a
     * number, a region is a rule. India has no daylight saving today, but a zone id survives a
     * government that introduces one, and reads as an intent rather than as a magic constant.
     */
    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private PlatformTime() {
    }
}
