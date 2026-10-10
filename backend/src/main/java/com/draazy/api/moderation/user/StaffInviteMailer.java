package com.draazy.api.moderation.user;

import com.draazy.api.identity.auth.StaffInviteService;
import com.draazy.api.identity.user.User;
import com.draazy.api.provider.EmailSender;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Emails a staff invite link to the account holder; the admin's copy-link dialog stays as the fallback. */
@Component
class StaffInviteMailer {

    private final EmailSender email;

    StaffInviteMailer(EmailSender email) {
        this.email = email;
    }

    void invited(User user, String inviteUrl) {
        send(user, inviteUrl, "You're invited to the Draazy back office",
                "You've been given a Draazy back-office account. Open this link to choose your password:");
    }

    void reset(User user, String inviteUrl) {
        send(user, inviteUrl, "Reset your Draazy back-office password",
                "Your Draazy back-office password was reset. Open this link to choose a new one:");
    }

    // After commit: a rolled-back create must not leave a live-looking link in someone's inbox.
    private void send(User user, String inviteUrl, String subject, String lead) {
        String to = user.getEmail();
        if (to == null || to.isBlank()) {
            return;
        }
        String text = "Hi " + user.getName() + ",\n\n" + lead + "\n\n" + inviteUrl
                + "\n\nThe link works once and expires in " + StaffInviteService.TTL.toDays()
                + " days. If you weren't expecting this email, "
                + "ignore it and tell your Draazy administrator.\n";
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                email.send(to, subject, text);
            }
        });
    }
}
