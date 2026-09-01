package com.punenest.api.identity.auth;

import static com.punenest.api.identity.auth.RefreshTokenService.MAX_CONSECUTIVE_GRACES;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.punenest.api.common.error.UnauthorizedException;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;

/**
 * The few seconds in which a replayed refresh token is a lost race rather than a theft.
 *
 * <p>Two tabs woken by the same event both find their access token expired and both refresh. One
 * wins; the other presents a token spent milliseconds ago. Read strictly that is reuse, and the
 * honest user is signed out of everything — most often on the flakiest connections, where the retry
 * that caused it was most needed. The client used to break the tie itself by comparing the stored
 * refresh token before and after taking the cross-tab lock; it cannot any more, because the token is
 * now an {@code HttpOnly} cookie it is not allowed to read. So the tie is broken here instead.
 *
 * <p>This is the only class that opens the window: {@code src/test/resources/application.properties}
 * shuts it for the whole suite, so that every other test presenting a spent token is testing the
 * security control rather than accidentally testing this exception to it.
 */
@SpringBootTest
@TestPropertySource(properties = "punenest.security.jwt.refresh-grace=15s")
@Transactional
@DisplayName("refresh grace window — a replay that lost a race is served, not punished")
class RefreshGraceWindowTest {

    @Autowired
    RefreshTokenService refreshTokens;

    @Autowired
    UserRepository users;

    private UUID persistUser() {
        User u = new User("9876500077", "buyer");
        u.setMobileVerified(true);
        return users.saveAndFlush(u).getId();
    }

    @Test
    @DisplayName("the losing tab is issued the family's live token rather than refused")
    void theLosingTabIsServedFromTheFamilysLiveHead() {
        UUID userId = persistUser();

        String first = refreshTokens.issue(userId);
        var winner = refreshTokens.rotate(first);

        // The losing tab replays what the winner just spent. It cannot be handed the winner's own
        // token back — only the hash of that is stored, and a hash is not reversible — so it is
        // handed a fresh one, minted by rotating the family's live head.
        var loser = refreshTokens.rotate(first);
        assertThat(loser.userId()).isEqualTo(userId);
        assertThat(loser.refreshToken()).isNotIn(first, winner.refreshToken());

        // Which means the winner's token is now spent too. That is the cost, and it is the right one:
        // the family still has exactly one live token, so the invariant reuse-detection depends on
        // survives. The winning tab discovers this at its next refresh and gets served in turn.
        assertThat(refreshTokens.rotate(loser.refreshToken()).userId()).isEqualTo(userId);
    }

    @Test
    @DisplayName("a token from a family that was already burned is still refused")
    void aBurnedFamilyIsNotResurrectedByTheWindow() {
        UUID userId = persistUser();

        String first = refreshTokens.issue(userId);
        var second = refreshTokens.rotate(first);

        // Revoking the live head leaves the family with nothing live in it. A replay now walks the
        // chain, finds no heir to serve from, and is refused — the window forgives a race, not an
        // absent session. Without this the window would be a way back in after a logout.
        refreshTokens.revokeAllForUser(userId);

        assertThatThrownBy(() -> refreshTokens.rotate(first))
                .isInstanceOf(UnauthorizedException.class);
        assertThatThrownBy(() -> refreshTokens.rotate(second.refreshToken()))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    @DisplayName("a thief and a victim cannot ping-pong forgiven replays indefinitely")
    void forgivenessIsBoundedPerChain() {
        UUID userId = persistUser();
        String stolen = refreshTokens.issue(userId);

        // The attack the window would otherwise permit, and the reason "the window is only seconds"
        // is not the bound it sounds like. A thief holding a copy of `stolen` rotates it, which makes
        // the family's head fresh; the victim's replay therefore lands inside a window the *thief* is
        // holding open, and is forgiven. The thief then replays what the victim just spent, landing
        // inside the window the victim opened. Neither party ever holds the live head, so every
        // exchange is forgiven and none of them is more than one hop deep — MAX_GRACE_HOPS never
        // gets a chance to cut it off. Left unbounded this runs for the full 30-day TTL.
        var thief1 = refreshTokens.rotate(stolen);
        var victim1 = refreshTokens.rotate(stolen);
        var thief2 = refreshTokens.rotate(thief1.refreshToken());
        var victim2 = refreshTokens.rotate(victim1.refreshToken());

        // Three consecutive graces is the limit, so the fourth exchange is refused and the family is
        // burned. The victim is signed out — which is the *point*: a forced re-authentication ends
        // the thief's access, where forgiving forever does not.
        assertThatThrownBy(() -> refreshTokens.rotate(thief2.refreshToken()))
                .isInstanceOf(UnauthorizedException.class);

        // Burned means burned: the token the last forgiven exchange minted is dead too, so the thief
        // cannot simply carry on with the newest one it holds.
        assertThatThrownBy(() -> refreshTokens.rotate(victim2.refreshToken()))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    @DisplayName("an uncontested rotation resets the count, so a repeatedly racing client survives")
    void aCleanRotationForgivesThePastRaces() {
        UUID userId = persistUser();
        String live = refreshTokens.issue(userId);

        // What separates the honest client from the attack is not how often it races but what happens
        // between races: it goes on to rotate a token nobody is contesting. Here it races once and
        // then rotates cleanly, over and over, far more times than the limit allows in a row. If the
        // count were a lifetime total this loop would sign the user out somewhere in the middle — the
        // failure mode a security control should least have, since it fires hardest on the flakiest
        // connections, which raced through no fault of their own.
        for (int cycle = 0; cycle < MAX_CONSECUTIVE_GRACES * 2; cycle++) {
            var winner = refreshTokens.rotate(live);
            var loser = refreshTokens.rotate(live); // the race: forgiven, count climbs to 1
            assertThat(loser.refreshToken()).isNotIn(live, winner.refreshToken());
            live = refreshTokens.rotate(loser.refreshToken()).refreshToken(); // clean: back to 0
        }

        // Still a working session after twice the limit in graces, because none of them were
        // consecutive.
        assertThat(refreshTokens.rotate(live).userId()).isEqualTo(userId);
    }
}
