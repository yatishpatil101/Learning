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
 * <p><strong>Scope of this class today.</strong> It is the shared home for the zone, but it is not
 * yet the only one: {@code SubscriptionService} and {@code PaymentWebhookController} each carry
 * their own private {@code IST} constant, and {@code AdminMetricsRepository} spells the same zone
 * as a SQL string. Pointing those at this constant is a separate change — this class exists so the
 * next one has somewhere to land rather than adding a fourth copy.
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
