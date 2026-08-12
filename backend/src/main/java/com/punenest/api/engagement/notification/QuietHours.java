package com.punenest.api.engagement.notification;

import com.punenest.api.common.PlatformTime;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.time.format.DateTimeParseException;
import java.util.Optional;

/**
 * The one place the quiet-hours window is interpreted.
 *
 * <p>The window is stored as two {@code HH:mm} wall-clock labels. Turning those into "is the user
 * asleep right now, and if so when do they wake up" has three edges that are each easy to get wrong
 * in isolation, which is the argument for a single class rather than an {@code if} at the call site:
 *
 * <ol>
 *   <li><strong>It wraps past midnight.</strong> The default window is 22:00–07:00, so the naive
 *       {@code now >= start && now < end} is false for every minute of it. A wrapping window is the
 *       common case here, not the exotic one — nobody sets quiet hours over their lunch break.</li>
 *   <li><strong>{@code start == end} means "never", not "always".</strong> Zero minutes and 1,440
 *       minutes are the same pair of labels; reading it as a whole day would mute a user forever
 *       because they dragged two sliders together. The browser's {@code inQuietHours} has always
 *       answered false for it and this agrees.</li>
 *   <li><strong>The close of the window is a future instant, not a time of day.</strong> At 23:00
 *       inside a 22:00–07:00 window the answer is <em>tomorrow's</em> 07:00; at 03:00 inside the
 *       same window it is <em>today's</em>. Getting this wrong by a day is the difference between a
 *       notification the user sees at breakfast and one they see the following breakfast.</li>
 * </ol>
 *
 * <p><strong>Which clock the wall-clock labels are read against — and the assumption in it.</strong>
 * {@link PlatformTime#IST}. This platform has no per-user timezone: {@code users} carries a
 * {@code city}, and nothing else about where the person is. So "22:00" is reckoned in the one
 * timezone the product is written for, exactly as every other date on this platform is. That is
 * correct for a Pune-first marketplace and wrong for a user who moves to London — they would be
 * silenced 17:30–02:30 local. The alternative available today would be the JVM default zone, which
 * is worse in kind rather than in degree: it makes the answer depend on which host the process was
 * scheduled on. Recorded as an explicit assumption rather than left implicit; a per-user zone is a
 * {@code users} column and a settings control, not a change to this class.
 */
final class QuietHours {

    private QuietHours() {
    }

    /**
     * When {@code at} falls inside {@code prefs}' quiet window, the instant that window closes.
     * Empty when quiet hours are off, the window is degenerate, or the user is awake.
     *
     * <p>Callers treat the returned instant as {@code notifications.deliver_after}: the notification
     * is written either way, and this is the moment it becomes visible.
     */
    static Optional<Instant> deferUntil(NotificationPreferencesDto prefs, Instant at) {
        QuietHoursDto window = prefs.quietHours();
        if (window == null || !window.enabled()) {
            return Optional.empty();
        }
        LocalTime start = wallClock(window.start());
        LocalTime end = wallClock(window.end());
        if (start == null || end == null || start.equals(end)) {
            return Optional.empty();
        }
        ZonedDateTime local = at.atZone(PlatformTime.IST);
        LocalTime now = local.toLocalTime();
        boolean inside = start.isBefore(end)
                ? (!now.isBefore(start) && now.isBefore(end))
                : (!now.isBefore(start) || now.isBefore(end));
        if (!inside) {
            return Optional.empty();
        }
        // Resolved through the zone rather than by adding minutes to an instant: `atZone` applies
        // the zone's gap/overlap rules, so this stays correct if a per-user timezone ever replaces
        // the constant. India has no DST, which is exactly why the difference would go unnoticed.
        ZonedDateTime closes = local.toLocalDate().atTime(end).atZone(PlatformTime.IST);
        // A wrapping window entered before midnight closes on the following day.
        if (!closes.isAfter(local)) {
            closes = closes.plusDays(1);
        }
        return Optional.of(closes.toInstant());
    }

    /**
     * {@code HH:mm} as a wall-clock time, or {@code null} if it is not that.
     *
     * <p>Malformed input is treated as "no window" rather than rejected, because this runs on the
     * <em>write</em> path of somebody else's notification: V73's CHECK constraint and the request
     * validation both stand between a client and a bad value, so reaching here with one means the
     * data is already wrong, and the two available failure modes are "deliver the notification" and
     * "throw inside the caller's transaction and roll back the offer that caused it". The first is
     * obviously right.
     */
    private static LocalTime wallClock(String label) {
        try {
            return LocalTime.parse(label);
        } catch (DateTimeParseException | NullPointerException notATime) {
            return null;
        }
    }
}
