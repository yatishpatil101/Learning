package com.draazy.api.provider.push;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.provider.PushSender;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

@DisplayName("Push sender selection")
class PushSenderWiringTest {

    private static Class<?> loggingSender() {
        try {
            return Class.forName(PushSender.class.getPackageName() + ".LoggingPushSender");
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException(e);
        }
    }

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withBean(ObjectMapper.class, () -> JsonMapper.builder().build())
            .withBean(PushProperties.class, () -> new PushProperties(
                    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
                    "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", null))
            .withUserConfiguration(WebPushSender.class, loggingSender());

    @Test
    @DisplayName("without a VAPID private key pushes are only logged")
    void loggingFallbackWithoutKeys() {
        runner.run(context -> assertThat(context.getBean(PushSender.class)).isNotInstanceOf(WebPushSender.class));
    }

    @Test
    @DisplayName("with a VAPID private key pushes go to the browser vendor's push service")
    void realSenderWithKeys() {
        runner.withPropertyValues("draazy.providers.push.vapid-private-key=yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
                .run(context -> assertThat(context.getBean(PushSender.class)).isInstanceOf(WebPushSender.class));
    }
}
