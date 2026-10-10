package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.security.BotDefence;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

// A Turnstile token is single-use, so challenging the verify step would refuse every sign-in once enforced.
@DisplayName("POST /auth/login bot defence")
class LoginBotDefenceTest {

    private static final String GOOD = "a-token-the-provider-accepts";

    private final AuthService auth = mock(AuthService.class);
    private final AuthController controller = new AuthController(auth, null, null, null, null,
            new BotDefence() {
                @Override
                public boolean enforced() {
                    return true;
                }

                @Override
                public boolean verify(String token, String remoteIp) {
                    return GOOD.equals(token);
                }
            });

    @Test
    @DisplayName("refuses the send step without a token, before an SMS is spent")
    void refusesSendWithoutToken() {
        assertThatThrownBy(() -> controller.login(
                new LoginRequest("9876500999", null, null, null), new MockHttpServletRequest()))
                .isInstanceOf(ForbiddenException.class);
        verify(auth, never()).login(any());
    }

    @Test
    @DisplayName("sends when the token is confirmed")
    void sendsWithToken() {
        when(auth.login(any())).thenReturn(AuthResponse.otpAck(30));
        MockHttpServletRequest http = new MockHttpServletRequest();
        http.addHeader("CF-Turnstile-Response", GOOD);

        assertThat(controller.login(new LoginRequest("9876500999", null, null, null), http)
                .getStatusCode().value()).isEqualTo(200);
    }

    @Test
    @DisplayName("lets the verify step through with no token")
    void verifiesWithoutToken() {
        when(auth.login(any())).thenReturn(AuthResponse.otpAck(30));

        controller.login(new LoginRequest("9876500999", "123456", null, null), new MockHttpServletRequest());

        verify(auth).login(any());
    }
}
