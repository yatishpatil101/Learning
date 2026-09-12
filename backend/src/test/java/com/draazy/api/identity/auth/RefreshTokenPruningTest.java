package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.sql.Timestamp;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("Slice D10 - refresh token pruning")
class RefreshTokenPruningTest extends AbstractApiTest {

    @Autowired
    RefreshTokenService refreshTokens;

    @Autowired
    UserRepository users;

    @Autowired
    RefreshTokenRepository tokens;

    private User user(String mobile) {
        User u = new User(mobile, "buyer");
        u.setName("Test User");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    @Test
    @DisplayName("pruneExpired deletes only rows with expires_at before cutoff")
    void pruneExpiredDeletesOnlyExpiredRows() {
        User u = user("9820400001");

        String expiredRaw = refreshTokens.issue(u.getId());
        String liveRaw = refreshTokens.issue(u.getId());
        tokens.flush();

        jdbc.update("update refresh_tokens set expires_at = ? where token_hash = ?",
            Timestamp.from(Instant.now().minusSeconds(60)), Tokens.sha256Hex(expiredRaw));
        jdbc.update("update refresh_tokens set expires_at = ? where token_hash = ?",
            Timestamp.from(Instant.now().plusSeconds(3600)), Tokens.sha256Hex(liveRaw));

        long deleted = refreshTokens.pruneExpired(Instant.now());

        assertThat(deleted).isEqualTo(1);
        assertThat(tokens.findByUserId(u.getId())).hasSize(1);
    }
}
