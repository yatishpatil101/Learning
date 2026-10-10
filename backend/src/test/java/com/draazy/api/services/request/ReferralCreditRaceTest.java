package com.draazy.api.services.request;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.identity.user.User;
import com.draazy.api.support.AbstractCommittedApiTest;
import com.draazy.api.support.Races;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

@DisplayName("Two parallel checkouts cannot both spend the last referral credit")
class ReferralCreditRaceTest extends AbstractCommittedApiTest {

    @Autowired ServiceRequestRepository requests;
    @Autowired ServiceRequestReferralCredit referralCredit;
    @Autowired TransactionTemplate tx;

    @Override
    protected String mobilePrefix() {
        return "98201990";
    }

    @AfterEach
    void sweepRequests() {
        tx.executeWithoutResult(s -> {
            jdbc.update("delete from service_request_timeline where request_id in "
                    + "(select id from service_requests where requester_id in "
                    + "(select id from users where mobile like ?))", mobilePrefix() + "%");
            jdbc.update("delete from service_requests where requester_id in "
                    + "(select id from users where mobile like ?)", mobilePrefix() + "%");
        });
    }

    @Test
    @DisplayName("one earned credit, two requests, two racing spends: exactly one wins")
    void onlyOneSpendWins() {
        User caller = user("01", "owner");
        for (int i = 0; i < 3; i++) {
            jdbc.update("""
                    insert into referrals (referrer_id, referrer_mobile, referred_mobile, channel, status)
                    values (?, ?, ?, 'owner', 'qualified')
                    """, caller.getId(), caller.getMobile(), "9782019" + "0" + i + "1");
        }
        UUID a = filed(caller, false);
        UUID b = filed(caller, true);
        AtomicInteger spent = new AtomicInteger();
        UUID[] ids = {a, b};

        List<Throwable> outcomes = Races.run(2, i -> tx.executeWithoutResult(s -> {
            ServiceRequest request = requests.findByIdForUpdate(ids[i]).orElseThrow();
            if (referralCredit.spend(request)) {
                spent.incrementAndGet();
                requests.saveAndFlush(request);
            }
            pause();
        }));

        assertThat(outcomes).containsOnlyNulls();
        assertThat(spent.get()).isEqualTo(1);
        assertThat(jdbc.queryForObject("""
                select count(*) from service_requests
                where requester_id = ? and referral_credit
                """, Long.class, caller.getId())).isEqualTo(1L);
    }

    // Holds the lock long enough that an unserialised second spend would have read the stale balance.
    private static void pause() {
        try {
            Thread.sleep(300);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    private UUID filed(User caller, boolean alreadyPaid) {
        return tx.execute(s -> {
            ServiceRequest request = new ServiceRequest(caller.getId(), ServiceRequestTypes.RENT_AGREEMENT,
                    null, null, null);
            request.awaitPayment(1000L);
            if (alreadyPaid) {
                request.moveTo(ServiceRequestStatus.NEW);
            }
            return requests.saveAndFlush(request).getId();
        });
    }
}
