package com.draazy.api.provider.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.draazy.api.provider.OtpSender;
import com.draazy.api.provider.ProviderCalls;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

@DisplayName("WhatsApp senders")
class WhatsAppSendersTest {

    private static final String MOBILE = "9811122233";

    private final WhatsAppClient client = mock(WhatsAppClient.class);
    private final ProviderCalls calls = mock(ProviderCalls.class);

    @BeforeEach
    void trackRunsTheCall() {
        doAnswer(invocation -> {
            ((Runnable) invocation.getArgument(4)).run();
            return null;
        }).when(calls).track(anyString(), anyString(), anyString(), any(), any(Runnable.class));
    }

    private static WhatsAppProperties props(String otpName, String otpLang, String idName, String idLang) {
        return new WhatsAppProperties(true, "https://graph.example", "v23.0", "PNID", "token",
                otpName, otpLang, idName, idLang, null, null);
    }

    private static WhatsAppProperties digestProps(String name, String lang) {
        return new WhatsAppProperties(true, "https://graph.example", "v23.0", "PNID", "token",
                "login", "en_US", null, null, name, lang);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> postedPayload() {
        ArgumentCaptor<Object> body = ArgumentCaptor.forClass(Object.class);
        verify(client).post(eq("/PNID/messages"), body.capture());
        return (Map<String, Object>) body.getValue();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> templateOf(Map<String, Object> payload) {
        return (Map<String, Object>) payload.get("template");
    }

    @Test
    @DisplayName("the OTP sender refuses to start without an approved template name and language")
    void otpSenderRequiresTemplate() {
        assertThatThrownBy(() -> new WhatsAppOtpSender(client, props(" ", "en_US", null, null), calls)
                .requireTemplate()).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("otp-template-name");
        assertThatThrownBy(() -> new WhatsAppOtpSender(client, props("login", null, null, null), calls)
                .requireTemplate()).isInstanceOf(IllegalStateException.class);
        assertThatCode(() -> new WhatsAppOtpSender(client, props("login", "en_US", null, null), calls)
                .requireTemplate()).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("an OTP goes out as an authentication template with the code in the body and the copy button")
    void otpPayload() {
        new WhatsAppOtpSender(client, props("login", "en_US", null, null), calls).send(MOBILE, "482913");

        Map<String, Object> payload = postedPayload();
        assertThat(payload).containsEntry("to", "91" + MOBILE).containsEntry("type", "template");
        Map<String, Object> template = templateOf(payload);
        assertThat(template).containsEntry("name", "login");
        assertThat(template.get("language")).isEqualTo(Map.of("code", "en_US"));
        List<?> components = (List<?>) template.get("components");
        assertThat(components).hasSize(2);
        assertThat(components.get(0)).isEqualTo(Map.of("type", "body",
                "parameters", List.of(Map.of("type", "text", "text", "482913"))));
        assertThat(components.get(1)).isEqualTo(Map.of("type", "button", "sub_type", "url", "index", "0",
                "parameters", List.of(Map.of("type", "text", "text", "482913"))));
    }

    @Test
    @DisplayName("a failed OTP send surfaces as DeliveryFailedException so the caller can tell the user")
    void otpFailure() {
        doThrow(new WhatsAppClient.WhatsAppException("down", "http 500")).when(client).post(anyString(), any());

        assertThatThrownBy(() -> new WhatsAppOtpSender(client, props("login", "en_US", null, null), calls)
                .send(MOBILE, "482913")).isInstanceOf(OtpSender.DeliveryFailedException.class);
    }

    @Test
    @DisplayName("a decision notice is skipped and recorded when the identity template is unset")
    void decisionSkippedWithoutTemplate() {
        new WhatsAppDecisionMessenger(client, props("login", "en_US", "", "en_US"), calls)
                .sendIdentityDecision(MOBILE, "Approved");
        new WhatsAppDecisionMessenger(client, props("login", "en_US", "decision", null), calls)
                .sendIdentityDecision(MOBILE, "Approved");

        verify(client, never()).post(anyString(), any());
        verify(calls, times(2)).record(eq(ProviderCalls.WHATSAPP), anyString(),
                eq(ProviderCalls.Outcome.SKIPPED), eq(MOBILE), any(), eq("template unset"), any());
    }

    @Test
    @DisplayName("a decision notice carries the line as the template's single body parameter")
    void decisionPayload() {
        new WhatsAppDecisionMessenger(client, props("login", "en_US", "decision", "en"), calls)
                .sendIdentityDecision(MOBILE, "Your identity check passed");

        Map<String, Object> payload = postedPayload();
        assertThat(payload).containsEntry("to", "91" + MOBILE);
        Map<String, Object> template = templateOf(payload);
        assertThat(template).containsEntry("name", "decision");
        assertThat(template.get("language")).isEqualTo(Map.of("code", "en"));
        assertThat(template.get("components")).isEqualTo(List.of(Map.of("type", "body",
                "parameters", List.of(Map.of("type", "text", "text", "Your identity check passed")))));
    }

    @Test
    @DisplayName("a digest the vendor refuses reports false so the caller can retry")
    void digestFailureIsReported() {
        doThrow(new WhatsAppClient.WhatsAppException("down", "http 500")).when(client).post(anyString(), any());

        assertThat(new WhatsAppDecisionMessenger(client, digestProps("waiting", "en_US"), calls)
                .sendWaitingDigest(MOBILE, "3 requests")).isFalse();
    }

    @Test
    @DisplayName("a failed decision notice is swallowed: the decision already stands in the app")
    void decisionFailureIsBestEffort() {
        doThrow(new WhatsAppClient.WhatsAppException("down", "network")).when(client).post(anyString(), any());

        assertThatCode(() -> new WhatsAppDecisionMessenger(client, props("login", "en_US", "decision", "en"), calls)
                .sendIdentityDecision(MOBILE, "Approved")).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("the waiting digest is skipped and recorded when its template is unset")
    void digestSkippedWithoutTemplate() {
        assertThat(new WhatsAppDecisionMessenger(client, digestProps("", "en_US"), calls)
                .sendWaitingDigest(MOBILE, "2 requests")).isFalse();
        assertThat(new WhatsAppDecisionMessenger(client, digestProps("waiting", null), calls)
                .sendWaitingDigest(MOBILE, "2 requests")).isFalse();

        verify(client, never()).post(anyString(), any());
        verify(calls, times(2)).record(eq(ProviderCalls.WHATSAPP), anyString(),
                eq(ProviderCalls.Outcome.SKIPPED), eq(MOBILE), any(), eq("template unset"), any());
    }

    @Test
    @DisplayName("the waiting digest carries the count phrase as the template's single body parameter")
    void digestPayload() {
        assertThat(new WhatsAppDecisionMessenger(client, digestProps("waiting", "en_US"), calls)
                .sendWaitingDigest(MOBILE, "3 requests")).isTrue();

        Map<String, Object> template = templateOf(postedPayload());
        assertThat(template).containsEntry("name", "waiting");
        assertThat(template.get("components")).isEqualTo(List.of(Map.of("type", "body",
                "parameters", List.of(Map.of("type", "text", "text", "3 requests")))));
    }
}
