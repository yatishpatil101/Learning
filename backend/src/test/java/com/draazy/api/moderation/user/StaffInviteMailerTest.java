package com.draazy.api.moderation.user;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.identity.user.User;
import com.draazy.api.security.Roles;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@DisplayName("Staff invite mailer")
class StaffInviteMailerTest {

    private final List<String[]> sent = new ArrayList<>();
    private final StaffInviteMailer mailer = new StaffInviteMailer((to, subject, text) -> sent.add(
            new String[] {to, subject, text}));

    @AfterEach
    void clear() {
        TransactionSynchronizationManager.clearSynchronization();
    }

    private static User staff(String email) {
        User user = new User("9866042099", Roles.Wire.STAFF);
        user.setName("Ops Hire");
        user.setEmail(email);
        return user;
    }

    @Test
    @DisplayName("sends the invite link to the holder only once the transaction commits")
    void sendsAfterCommit() {
        TransactionSynchronizationManager.initSynchronization();

        mailer.invited(staff("hire@example.com"), "https://draazy.com/staff-invite#abc.def");
        assertThat(sent).isEmpty();

        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)[0]).isEqualTo("hire@example.com");
        assertThat(sent.get(0)[1]).contains("invited");
        assertThat(sent.get(0)[2]).contains("Hi Ops Hire", "https://draazy.com/staff-invite#abc.def", "7 days");
    }

    @Test
    @DisplayName("an account without an email is skipped, not failed")
    void skipsWithoutEmail() {
        TransactionSynchronizationManager.initSynchronization();

        mailer.reset(staff(null), "https://draazy.com/staff-invite#abc.def");
        assertThat(TransactionSynchronizationManager.getSynchronizations()).isEmpty();
    }
}
