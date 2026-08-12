package com.punenest.api.provider;

import com.punenest.api.security.DevOnly;
import com.punenest.api.security.DevProfileGuard;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Seam for delivering a back-office invite token to the person it is for (tech debt D206).
 *
 * <p><strong>Why the token leaves through a port rather than through the response.</strong> D206 is
 * that the two administrators who co-sign an account must be unable to set or learn its credential.
 * Returning the token from {@code POST /users/staff} would hand it straight to the maker and change
 * nothing; returning it from {@code POST /users/{id}/approve} would hand it to the checker instead.
 * The only delivery that satisfies the rule is one that goes to the invitee and to nobody else, so
 * the token is dispatched here and is never part of any HTTP body.
 *
 * <p>Which way round the implementations are selected is the same security control {@link OtpSender}
 * documents (D147): the mock is opt-in under {@link DevOnly}, and anything else — an unrecognised
 * profile, a typo, no profile at all — gets the real sender. A build that logs credentials can only
 * appear where somebody asked for it by name.
 */
public interface StaffInviteSender {

    /**
     * Deliver {@code token} to {@code mobile}. Implementations must not block the request thread
     * long, and must never log or persist the token outside the delivery itself.
     */
    void send(String mobile, String token);
}

/** Dev only: log the invite so testers can redeem it from the console — no external call, no key. */
@Component
@DevOnly
class MockStaffInviteSender implements StaffInviteSender {

    private static final Logger log = LoggerFactory.getLogger(MockStaffInviteSender.class);

    @Override
    public void send(String mobile, String token) {
        log.info("[MOCK STAFF INVITE] mobile={} token={}", mobile, token);
    }
}

/**
 * Prod stub: fail loudly until a real delivery channel is wired in.
 *
 * <p>Throwing rather than logging a warning is the safe failure here, and deliberately so. The call
 * sits inside the transaction that creates the account, so a throw rolls the whole creation back and
 * the administrator is told it did not work. The alternative — swallow the failure and return 201 —
 * would leave a real back-office account in existence whose only holder is a token nobody received,
 * and the first person to notice would be the colleague who never got their invite.
 *
 * <p>Bound to "not dev" rather than to {@code prod} for the reason {@link OtpSender} gives: a
 * staging or preview environment must get a bean at all, or the app fails to start for a reason that
 * reads as a wiring bug.
 */
@Component
@Profile(DevProfileGuard.NOT_DEV)
class SmsStaffInviteSender implements StaffInviteSender {

    @Override
    public void send(String mobile, String token) {
        throw new UnsupportedOperationException(
                "Staff invite delivery is not configured for this environment yet");
    }
}
