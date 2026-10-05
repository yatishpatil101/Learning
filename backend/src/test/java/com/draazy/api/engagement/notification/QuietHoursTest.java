package com.draazy.api.engagement.notification;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.common.PlatformTime;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

@DisplayName("Quiet hours — the window arithmetic (D94)")
class QuietHoursTest {

    private static Instant ist(String isoLocal) {
        return LocalDateTime.parse(isoLocal).atZone(PlatformTime.IST).toInstant();
    }

    @ParameterizedTest(name = "{0}")
    @DisplayName("deferUntil answers the instant the window closes, or nothing when the user is awake")
    @CsvSource(delimiter = '|', value = {
            "outside a wrapping window is delivered now | true | 22:00 | 07:00 | 2027-01-10T12:00 | NONE",
            "23:00 in a wrapping window defers to the NEXT morning | true | 22:00 | 07:00 | 2027-01-10T23:00 | 2027-01-11T07:00",
            "03:00 in a wrapping window defers to THIS morning | true | 22:00 | 07:00 | 2027-01-11T03:00 | 2027-01-11T07:00",
            "inside a same-day window closes the same day | true | 09:00 | 17:00 | 2027-01-10T12:00 | 2027-01-10T17:00",
            "outside a same-day window is not read as wrapping | true | 09:00 | 17:00 | 2027-01-10T23:00 | NONE",
            "quiet hours switched off never defer | false | 22:00 | 07:00 | 2027-01-10T23:00 | NONE",
            "start == end means never, not always | true | 22:00 | 22:00 | 2027-01-10T23:00 | NONE"
    })
    void deferUntil(String label, boolean enabled, String start, String end, String at, String expected) {
        NotificationPreferencesDto prefs = new NotificationPreferencesDto(
                true, false, true, true, new QuietHoursDto(enabled, start, end), "en");

        Optional<Instant> deferred = QuietHours.deferUntil(prefs, ist(at));

        assertThat(deferred)
                .isEqualTo("NONE".equals(expected) ? Optional.empty() : Optional.of(ist(expected)));
    }
}
