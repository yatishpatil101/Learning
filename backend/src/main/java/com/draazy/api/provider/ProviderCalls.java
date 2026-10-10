package com.draazy.api.provider;

import com.draazy.api.common.trust.MobileMask;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientResponseException;

/** One background thread writes rows, so recording never blocks, fails or rolls back the call it describes
 * nor competes with that call's transaction for a second pool connection. */
@Component
public class ProviderCalls {

    public static final String ZEPTOMAIL = "zeptomail";
    public static final String WHATSAPP = "whatsapp";
    public static final String CASHFREE = "cashfree";

    public static final Duration RETENTION = Duration.ofDays(90);

    private static final Logger log = LoggerFactory.getLogger(ProviderCalls.class);
    private static final int MAX_DETAIL = 200;
    private static final int MAX_PENDING = 1_000;
    private static final long EVERY_DAY_MS = 24L * 60L * 60L * 1000L;
    private static final long AFTER_STARTUP_MS = 10L * 60L * 1000L;
    private static final String INSERT = """
            INSERT INTO provider_call (provider, operation, outcome, recipient, recipient_hash,
                                       reference, detail, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""";

    public enum Outcome {
        OK, FAILED, SKIPPED;

        public String wire() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    /** An exception that already carries a log-safe vendor diagnosis (codes, never free text). */
    public interface Diagnosed {
        String diagnosis();
    }

    private final JdbcTemplate jdbc;
    private final Executor writer;

    @Autowired
    public ProviderCalls(JdbcTemplate jdbc) {
        this(jdbc, new ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(MAX_PENDING), Thread.ofPlatform().daemon().name("provider-call-writer").factory(),
                (task, pool) -> log.warn("provider_call writer is full; a ledger row was dropped")));
    }

    ProviderCalls(JdbcTemplate jdbc, Executor writer) {
        this.jdbc = jdbc;
        this.writer = writer;
    }

    @PreDestroy
    void drain() throws InterruptedException {
        if (writer instanceof ExecutorService pool) {
            pool.shutdown();
            pool.awaitTermination(5, TimeUnit.SECONDS);
        }
    }

    /** Runs {@code call}, records it as ok or failed, and rethrows any failure unchanged. */
    public <T> T track(String provider, String operation, String recipient, String reference,
            Supplier<T> call) {
        long started = System.nanoTime();
        try {
            T result = call.get();
            record(provider, operation, Outcome.OK, recipient, reference, null, elapsedMs(started));
            return result;
        } catch (RuntimeException e) {
            record(provider, operation, Outcome.FAILED, recipient, reference, diagnosis(e), elapsedMs(started));
            throw e;
        }
    }

    public void track(String provider, String operation, String recipient, String reference, Runnable call) {
        track(provider, operation, recipient, reference, () -> {
            call.run();
            return null;
        });
    }

    public void record(String provider, String operation, Outcome outcome, String recipient,
            String reference, String detail, Integer durationMs) {
        Object[] row = {provider, operation, outcome.wire(), mask(recipient), hashRecipient(recipient),
                reference, truncate(detail), durationMs};
        try {
            writer.execute(() -> write(provider, operation, row));
        } catch (RuntimeException e) {
            log.warn("Could not queue {} {} call: {}", provider, operation, e.getClass().getSimpleName());
        }
    }

    private void write(String provider, String operation, Object[] row) {
        try {
            jdbc.update(INSERT, row);
        } catch (RuntimeException e) {
            log.warn("Could not record {} {} call: {}", provider, operation, e.getClass().getSimpleName());
        }
    }

    @Scheduled(fixedDelay = EVERY_DAY_MS, initialDelay = AFTER_STARTUP_MS)
    public void purgeExpired() {
        try {
            jdbc.update("DELETE FROM provider_call WHERE created_at < now() - make_interval(days => ?)",
                    (int) RETENTION.toDays());
        } catch (RuntimeException e) {
            log.error("provider_call retention sweep failed; will retry on the next tick", e);
        }
    }

    /** Exact-match search key; null when the value is neither an email nor a 10-digit mobile. */
    public static String hashRecipient(String recipient) {
        String normalised = normalise(recipient);
        if (normalised == null) {
            return null;
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(normalised.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    static String mask(String recipient) {
        if (recipient == null || recipient.isBlank()) {
            return null;
        }
        return recipient.contains("@") ? EmailSender.maskAddress(recipient.strip()) : MobileMask.mask(recipient);
    }

    public static String diagnosis(Throwable failure) {
        for (Throwable t = failure; t != null; t = t.getCause()) {
            if (t instanceof Diagnosed diagnosed) {
                return diagnosed.diagnosis();
            }
            if (t instanceof RestClientResponseException http) {
                return "http " + http.getStatusCode().value();
            }
            if (t instanceof ResourceAccessException) {
                return "network";
            }
        }
        return failure.getClass().getSimpleName();
    }

    private static String normalise(String recipient) {
        if (recipient == null || recipient.isBlank()) {
            return null;
        }
        String trimmed = recipient.strip();
        return trimmed.contains("@") ? trimmed.toLowerCase(Locale.ROOT) : MobileMask.normalise(trimmed);
    }

    private static String truncate(String detail) {
        return detail == null || detail.length() <= MAX_DETAIL ? detail : detail.substring(0, MAX_DETAIL);
    }

    private static int elapsedMs(long startedNanos) {
        return (int) Math.min(Integer.MAX_VALUE, (System.nanoTime() - startedNanos) / 1_000_000L);
    }
}
