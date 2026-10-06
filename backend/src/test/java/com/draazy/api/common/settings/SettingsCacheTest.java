package com.draazy.api.common.settings;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** The Java suite and e2e run with this cache off, so this is where its behaviour is proved. */
class SettingsCacheTest {

    private final SettingRepository repository = mock(SettingRepository.class);

    @AfterEach
    void clearSynchronization() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void aRepeatReadIsAnsweredFromMemoryIncludingAMissingRow() {
        stored("fees", "{\"gstPercent\":18}");
        when(repository.findById("geo")).thenReturn(Optional.empty());
        SettingsCache cache = new SettingsCache(repository, Duration.ofSeconds(30));

        assertThat(cache.value("fees")).contains("{\"gstPercent\":18}");
        assertThat(cache.value("fees")).contains("{\"gstPercent\":18}");
        assertThat(cache.value("geo")).isEmpty();
        assertThat(cache.value("geo")).isEmpty();

        verify(repository, times(1)).findById("fees");
        verify(repository, times(1)).findById("geo");
    }

    @Test
    void aZeroTtlReadsEveryTime() {
        stored("fees", "{}");
        SettingsCache cache = new SettingsCache(repository, Duration.ZERO);

        cache.value("fees");
        cache.value("fees");

        verify(repository, times(2)).findById("fees");
    }

    @Test
    void anAdminWriteIsSeenOnlyOnceItsTransactionCommits() {
        stored("fees", "{\"v\":1}");
        SettingsCache cache = new SettingsCache(repository, Duration.ofSeconds(30));
        cache.value("fees");

        TransactionSynchronizationManager.initSynchronization();
        stored("fees", "{\"v\":2}");
        cache.evictAfterCommit();
        assertThat(cache.value("fees")).contains("{\"v\":1}");

        TransactionSynchronizationManager.getSynchronizations()
                .forEach(TransactionSynchronization::afterCommit);
        assertThat(cache.value("fees")).contains("{\"v\":2}");
    }

    @Test
    void anEvictionOutsideATransactionIsImmediate() {
        stored("fees", "{\"v\":1}");
        SettingsCache cache = new SettingsCache(repository, Duration.ofSeconds(30));
        cache.value("fees");

        stored("fees", "{\"v\":2}");
        cache.evictAfterCommit();

        assertThat(cache.value("fees")).contains("{\"v\":2}");
    }

    private void stored(String key, String json) {
        Setting row = new Setting(key);
        row.setValue(json);
        when(repository.findById(key)).thenReturn(Optional.of(row));
    }
}
