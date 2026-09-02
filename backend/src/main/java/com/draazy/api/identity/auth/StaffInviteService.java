package com.draazy.api.identity.auth;

import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.StaffInviteSender;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issues and redeems the single-use invites that let a back-office colleague set their own password
 * (tech debt D206, V71).
 *
 * <p><strong>The defect this closes.</strong> Maker-checker (D200) stopped one administrator minting
 * a colleague alone, but {@code StaffCreate} still carried a {@code password} field — so the maker
 * chose the credential and the checker's co-signature attested to a <em>record</em> rather than to a
 * <em>person</em>. A maker could mint "a new ops lead", have a peer approve it in good faith, and
 * then sign in as that ops lead: the peer's name is on the decision, the maker holds the session.
 * Neither administrator now has any way to set or read the credential.
 *
 * <p><strong>Why this lives in {@code identity.auth} and not beside the account factory.</strong>
 * Everything here is authentication: it mints a credential, it gates token issue, and it writes a
 * password hash. {@code moderation} (layer 6) calls down into it, which is a legal direction; the
 * reverse would not have been, and is exactly why {@code staff_account_approvals} had to be
 * kernel-owned. Keeping it here means the answer to "may this caller obtain a token at all" stays in
 * one package.
 */
@Service
public class StaffInviteService {

    /**
     * How long a colleague has to set their password.
     *
     * <p>Long enough to survive a weekend and a missed message; short enough that an invite sitting
     * unread in an SMS history is not a permanent credential. An expired invite currently strands
     * the account — there is no reissue route yet — and the remedy is to archive it and mint another;
     * see V71 for why that is the deliberate reading rather than an oversight.
     */
    static final Duration TTL = Duration.ofDays(7);

    /**
     * Separates the selector from the secret in the delivered token.
     *
     * <p>Split on the FIRST occurrence: the selector is a UUID and can never contain one, so
     * everything after it is the secret however the secret happens to be encoded.
     */
    private static final String SEPARATOR = ".";

    private final StaffInviteRepository invites;
    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final StaffInviteSender sender;

    public StaffInviteService(StaffInviteRepository invites, UserRepository users,
            PasswordEncoder passwordEncoder, StaffInviteSender sender) {
        this.invites = invites;
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.sender = sender;
    }

    /**
     * Mint an invite for a freshly created account and dispatch it to the invitee.
     *
     * <p><strong>Returns nothing on purpose.</strong> The raw token exists in this method's frame
     * and in the delivery call, and nowhere else — not in the return value, not in an audit row, not
     * in the database, which holds only {@code sha256(secret)}. Handing it back to the caller would
     * put it in {@code UserAdminService}'s hands, one field away from the 201 body, and the whole
     * point of D206 is that the administrators on either side of this account never hold it.
     *
     * <p>Participates in the caller's transaction rather than owning one, so an account and its
     * invite are created together or not at all. That also means a delivery failure rolls the
     * account back — see {@link StaffInviteSender} for why that is the wanted behaviour.
     *
     * @param userId    the account that cannot authenticate until this is redeemed
     * @param mobile    where to deliver it — the invitee's number, out of band
     * @param createdBy the administrator who minted the account, recorded but never told the token
     */
    @Transactional
    public void issue(UUID userId, String mobile, UUID createdBy) {
        String secret = Tokens.randomToken();
        StaffInvite invite = invites.saveAndFlush(new StaffInvite(userId,
                Tokens.sha256Hex(secret), createdBy, Instant.now().plus(TTL)));
        sender.send(mobile, invite.getId() + SEPARATOR + secret);
    }

    /**
     * {@code POST /auth/staff-invite/redeem} — the invitee presents their token and chooses a
     * password.
     *
     * <p><strong>Every refusal is the same 401 with the same message.</strong> Unknown selector,
     * wrong secret, expired, already redeemed, account since archived — all indistinguishable to the
     * caller. Distinguishing them would turn this route into an oracle: "already redeemed" tells an
     * attacker a guessed selector was real, and "expired" tells them the account exists and is worth
     * a second look. The person who legitimately holds the token is not helped by the distinction
     * either, since their remedy is the same in every case: ask an administrator.
     *
     * <p><strong>The secret is compared in constant time.</strong> The selector fetches exactly one
     * row and {@link Tokens#hashesEqual} then does the comparison with
     * {@link java.security.MessageDigest#isEqual}, so response timing says nothing about how many
     * leading characters of a guess were right. Looking the row up <em>by</em> the hash would have
     * been shorter and would have moved that comparison into the database's indexed {@code =}, which
     * is neither constant-time nor ours to reason about.
     *
     * <p>Redeeming does <em>not</em> let the account sign in on its own. If the account is also
     * awaiting a second administrator, {@link AuthService} still refuses it; the two gates are
     * independent and both have to be satisfied. That ordering is deliberate — a colleague can set
     * their password the moment they are told about the job, and the approval decision stays with
     * the administrators.
     */
    @Transactional
    public void redeem(String token, String password) {
        StaffInvite invite = openInviteFor(token);
        User user = users.findByIdAndArchivedFalse(invite.getUserId())
                .orElseThrow(StaffInviteService::refuse);
        user.setPasswordHash(passwordEncoder.encode(password));
        invite.redeem();
        invites.save(invite);
    }

    /** Resolve a presented token to the one open invite it names, or refuse indistinguishably. */
    private StaffInvite openInviteFor(String token) {
        int split = token == null ? -1 : token.indexOf(SEPARATOR);
        if (split <= 0 || split == token.length() - 1) {
            throw refuse();
        }
        UUID selector;
        try {
            selector = UUID.fromString(token.substring(0, split));
        } catch (IllegalArgumentException notAUuid) {
            throw refuse();
        }
        StaffInvite invite = invites.findById(selector).orElseThrow(StaffInviteService::refuse);
        String presented = Tokens.sha256Hex(token.substring(split + 1));
        if (!Tokens.hashesEqual(presented, invite.getTokenHash())
                || invite.isRedeemed()
                || invite.isExpired(Instant.now())) {
            throw refuse();
        }
        return invite;
    }

    /** The single answer every failure gives. See {@link #redeem} for why it is deliberately vague. */
    private static UnauthorizedException refuse() {
        return new UnauthorizedException(
                "This invite link is not valid. Ask an administrator to send you a new one.");
    }
}
