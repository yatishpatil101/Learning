package com.draazy.api.provider;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.provider.places.GooglePlacesLookup;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

@DisplayName("Provider wiring — Places lookup")
class PlacesLookupWiringTest {

    private ApplicationContextRunner runner(String profile) {
        ApplicationContextRunner base = new ApplicationContextRunner()
                .withUserConfiguration(DevPlacesLookup.class, UnconfiguredPlacesLookup.class,
                        GooglePlacesLookup.class);
        return profile == null ? base
                : base.withInitializer(context -> context.getEnvironment().setActiveProfiles(profile));
    }

    @ParameterizedTest(name = "{0} with no key trusts the client's hint")
    @ValueSource(strings = {"local"})
    @DisplayName("only the local profile gets the dev lookup")
    void localGetsTheDevLookup(String profile) {
        runner(profile).withPropertyValues("draazy.google.places.server-key=").run(context -> {
            assertThat(context).hasSingleBean(PlacesLookup.class);
            assertThat(context.getBean(PlacesLookup.class)).isInstanceOf(DevPlacesLookup.class);
        });
    }

    @ParameterizedTest(name = "{0} with a blank or whitespace key fails on use")
    @ValueSource(strings = {"prod", "sandbox"})
    @DisplayName("a deployment with no key never trusts the client")
    void deploymentsWithoutAKeyGetTheFailingLookup(String profile) {
        for (String key : new String[] {"", "   "}) {
            runner(profile).withPropertyValues("draazy.google.places.server-key=" + key).run(context -> {
                assertThat(context).hasSingleBean(PlacesLookup.class);
                assertThat(context.getBean(PlacesLookup.class)).isInstanceOf(UnconfiguredPlacesLookup.class);
            });
        }
    }

    @ParameterizedTest(name = "no profile with no key is not the dev lookup")
    @ValueSource(strings = {"unknown"})
    @DisplayName("an unfamiliar profile is treated as a deployment")
    void unfamiliarProfilesAreNotLocal(String profile) {
        runner(profile).withPropertyValues("draazy.google.places.server-key=").run(context ->
                assertThat(context.getBean(PlacesLookup.class)).isInstanceOf(UnconfiguredPlacesLookup.class));
    }

    @ParameterizedTest(name = "{0} with a key asks Google")
    @ValueSource(strings = {"local", "prod", "sandbox"})
    @DisplayName("a key wires the real lookup on every profile")
    void aKeyWiresGoogle(String profile) {
        runner(profile).withPropertyValues("draazy.google.places.server-key=test-key").run(context -> {
            assertThat(context).hasSingleBean(PlacesLookup.class);
            assertThat(context.getBean(PlacesLookup.class)).isInstanceOf(GooglePlacesLookup.class);
        });
    }

    @org.junit.jupiter.api.Test
    @DisplayName("the unconfigured lookup reports itself as unavailable rather than crashing the request")
    void unconfiguredIsUnavailable() {
        UnconfiguredPlacesLookup lookup = new UnconfiguredPlacesLookup();

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> lookup.details("id", null))
                .isInstanceOf(PlacesLookup.UnavailableException.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> lookup.details("id", null))
                .isInstanceOf(PlacesLookup.UnavailableException.class);
    }
}
