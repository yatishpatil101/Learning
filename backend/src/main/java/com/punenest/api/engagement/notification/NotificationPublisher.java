package com.punenest.api.engagement.notification;

import com.punenest.api.common.trust.Notifier;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The {@link Notifier} port, implemented where notifications actually live.
 *
 * <p>This is the {@code engagement} half of the inversion described on the interface: contexts that
 * rank at or below {@code engagement} — {@code leads} being the first — can announce something
 * without importing this package, and the dependency arrow points down rather than sideways.
 *
 * <p>{@code saveAndFlush} rather than {@code save}: both enlist in the caller's transaction and both
 * roll back with it, so the choice is not about durability. Flushing surfaces a constraint failure
 * at the call that caused it instead of at commit, where it would be attributed to whatever the
 * caller was doing next.
 *
 * <h2>Delivery rules (tech debt D94)</h2>
 *
 * <p>This method is where the user's preferences are applied, and it is deliberately the
 * <em>only</em> place. Every server-side notification on this platform is written through
 * {@link Notifier#notify} — eight call sites at the time of writing, across visits, offers, contact
 * requests, messages, document grants and listing moderation — so a rule enforced here cannot be
 * forgotten by the ninth. The interface's own Javadoc reserved exactly this: "anything richer —
 * email, SMS, quiet-hours suppression, per-user preferences — belongs behind this boundary and not
 * in the vocabulary of the contexts that call it". Until now nothing was behind it.
 *
 * <p><strong>Quiet hours DEFER; they do not suppress.</strong> Given a notification written at
 * 03:00 into a 22:00–07:00 window, the two available behaviours are "drop it" and "hold it until
 * 07:00", and they are not close. The inbox is the only place a notification is ever read, so
 * dropping one means an owner never learns an offer arrived — a permanent loss of information the
 * user never asked to lose. They asked not to be disturbed at 03:00, which is a statement about
 * <em>when</em>, and deferral is the answer to a question about when. So the row is always written,
 * with its true {@code createdAt}, and {@code deliverAfter} carries the instant the window closes.
 * {@link NotificationService#list} withholds it until then.
 *
 * <p>Deferral needs no scheduler: {@code deliver_after <= now()} in the read is the entire
 * mechanism. A sweep clearing a flag at 07:00 would give the same user-visible result while adding
 * something that can lag, double-fire or need a leader election, and would leave a window in which
 * a row is due but not yet released. Same argument V63 makes for deriving the verification badge
 * rather than sweeping it.
 *
 * <p><strong>The master switch drops rather than defers</strong>, because it means something else.
 * {@code matchAlerts: false} is not "later", it is "do not generate these for me at all" — there is
 * no moment at which the user wants a saved-search alert they switched off. It governs proactive
 * alert families only; see {@link NotificationTypes} for why an offer is not one of them.
 *
 * <p><strong>What this does NOT yet honour, stated plainly.</strong> The {@code email}, {@code sms}
 * and {@code whatsapp} switches, and {@code language}, are stored and returned but consulted by
 * nothing — because nothing on this server sends email, SMS or WhatsApp. This port writes an in-app
 * inbox row and that is the whole of delivery today. Gating the in-app row on a switch labelled
 * "Email" would be worse than not gating it: a user who unticks email would stop seeing
 * notifications in the app. The switches are persisted so the first real channel sender inherits an
 * answer instead of a migration.
 */
@Component
public class NotificationPublisher implements Notifier {

    private final NotificationRepository notifications;
    private final NotificationPreferenceService preferences;

    /**
     * The instant source the quiet-hours decision is made against — a seam, not a knob.
     *
     * <p>Zone-agnostic on purpose: {@link QuietHours} decides which wall clock the instant is read
     * against. A test pins it with {@link Clock#fixed} to put a write at 23:00 or 03:00 without
     * waiting for either. Not constructor-injected because there is no {@code Clock} bean in this
     * application and adding one for a single collaborator would put a new global in everyone's
     * context — the same call {@code FinanceService} made. Not final only
     * so {@link #useClock} can reach it; nothing in production calls that.
     */
    private Clock clock = Clock.systemUTC();

    public NotificationPublisher(NotificationRepository notifications,
            NotificationPreferenceService preferences) {
        this.notifications = notifications;
        this.preferences = preferences;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void notify(UUID userId, String type, String title, String body, String link) {
        NotificationPreferencesDto prefs = preferences.effective(userId);
        if (NotificationTypes.isMatchAlert(type) && !prefs.matchAlerts()) {
            return;
        }
        Notification note = new Notification(userId, type, title, body);
        note.setLink(link);
        note.setDeliverAfter(QuietHours.deferUntil(prefs, Instant.now(clock)).orElse(null));
        notifications.saveAndFlush(note);
    }

    /** Pin the clock. Test seam — see the field. */
    void useClock(Clock pinned) {
        this.clock = pinned;
    }
}
