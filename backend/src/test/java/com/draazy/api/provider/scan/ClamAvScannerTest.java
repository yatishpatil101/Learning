package com.draazy.api.provider.scan;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.provider.DocumentScanner.Verdict;
import com.draazy.api.provider.DocumentScanner.Verdict.Outcome;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

/**
 * The clamd adapter (tech-debt D131), tested against a socket that speaks the three replies that
 * matter and against one that is not there at all.
 *
 * <p>The last case is the one this class exists for. Everything else here is protocol plumbing; a
 * scanner that is switched on, cannot be reached, and lets the upload through anyway is the failure
 * mode that makes the whole control a lie, and it is invisible in production until it matters.
 */
@DisplayName("ClamAV scanner — INSTREAM protocol and fail-closed behaviour (tech-debt D131)")
class ClamAvScannerTest {

    private static final byte[] PDF = "%PDF-1.7 sale deed".getBytes(StandardCharsets.US_ASCII);

    /**
     * A one-shot stand-in for clamd: accepts a single connection, reads a complete {@code INSTREAM}
     * exchange, and answers with a fixed NUL-terminated line.
     *
     * <p>It parses the framing rather than reading to EOF, and that is not fussiness. The client
     * finishes by sending a zero-length chunk and then <em>waits</em> for the reply, so there is no
     * EOF to read to; and "stop when the last four bytes are zero" would fire early on any payload
     * containing four zero bytes, which every real scanned PDF does.
     */
    private static final class FakeClamd implements AutoCloseable {

        private final ServerSocket server;
        private final AtomicReference<byte[]> received = new AtomicReference<>(new byte[0]);
        private final AtomicInteger chunks = new AtomicInteger();
        private final CountDownLatch done = new CountDownLatch(1);

        FakeClamd(String reply) throws IOException {
            this.server = new ServerSocket(0);
            Thread thread = new Thread(() -> {
                try (Socket socket = server.accept();
                        DataInputStream in = new DataInputStream(socket.getInputStream());
                        OutputStream out = socket.getOutputStream()) {
                    byte[] command = new byte[INSTREAM.length()];
                    in.readFully(command);

                    var payload = new ByteArrayOutputStream();
                    int length;
                    while ((length = in.readInt()) > 0) {
                        byte[] chunk = new byte[length];
                        in.readFully(chunk);
                        payload.write(chunk);
                        chunks.incrementAndGet();
                    }

                    received.set(payload.toByteArray());
                    out.write(reply.getBytes(StandardCharsets.US_ASCII));
                    out.write(0);
                    out.flush();
                } catch (IOException ignored) {
                    // The test asserts on the client's behaviour; a broken fake shows up there.
                } finally {
                    done.countDown();
                }
            });
            thread.setDaemon(true);
            thread.start();
        }

        int port() {
            return server.getLocalPort();
        }

        /** The reassembled file, once the exchange has finished. */
        byte[] payload() throws InterruptedException {
            done.await(5, TimeUnit.SECONDS);
            return received.get();
        }

        int chunkCount() throws InterruptedException {
            done.await(5, TimeUnit.SECONDS);
            return chunks.get();
        }

        @Override
        public void close() throws IOException {
            server.close();
        }
    }

    private static final String INSTREAM = "zINSTREAM\0";

    private static ClamAvScanner scannerFor(int port) {
        return new ClamAvScanner("127.0.0.1", port, 2000, 32768);
    }

    /** A port nothing is listening on: bind one, note it, release it. */
    private static int deadPort() throws IOException {
        try (ServerSocket probe = new ServerSocket(0)) {
            return probe.getLocalPort();
        }
    }

    // ---------------- the point of the class ----------------

    @Test
    @DisplayName("enabled but unreachable REJECTS the upload — it never falls back to accepting")
    void failsClosedWhenTheDaemonIsNotThere() throws Exception {
        ClamAvScanner scanner = scannerFor(deadPort());

        // Not a clean verdict, not a swallowed exception, not a log-and-continue. The upload dies.
        assertThatThrownBy(() -> scanner.scan("deed.pdf", "application/pdf", PDF))
                .isInstanceOf(UncheckedIOException.class)
                .hasMessageContaining("scanner unavailable");
    }

    @Test
    @DisplayName("an unusable reply is undecided, and undecided is not clean")
    void failsClosedOnAReplyItCannotInterpret() throws Exception {
        try (FakeClamd clamd = new FakeClamd("INSTREAM size limit exceeded. ERROR")) {
            assertThatThrownBy(
                    () -> scannerFor(clamd.port()).scan("deed.pdf", "application/pdf", PDF))
                    .isInstanceOf(UncheckedIOException.class)
                    .hasMessageContaining("unusable reply");
        }
    }

    @Test
    @DisplayName("the bean does not exist unless a daemon is explicitly configured")
    void isInertUntilSwitchedOn() {
        // Asserted on the annotation rather than by booting a context, because the thing worth
        // pinning is the default: `matchIfMissing` must stay absent, or every developer machine
        // and CI runner starts rejecting every upload the moment this class is on the classpath.
        ConditionalOnProperty gate = ClamAvScanner.class.getAnnotation(ConditionalOnProperty.class);

        assertThat(gate).isNotNull();
        assertThat(gate.prefix()).isEqualTo("draazy.providers.clamav");
        assertThat(gate.name()).containsExactly("enabled");
        assertThat(gate.havingValue()).isEqualTo("true");
        assertThat(gate.matchIfMissing()).isFalse();
    }

    // ---------------- the protocol ----------------

    @Test
    @DisplayName("a clean file comes back clean, and the whole file is what reaches the daemon")
    void streamsTheFileAndAcceptsAnOkReply() throws Exception {
        try (FakeClamd clamd = new FakeClamd("stream: OK")) {
            Verdict verdict = scannerFor(clamd.port()).scan("deed.pdf", "application/pdf", PDF);

            assertThat(verdict.isClean()).isTrue();
            // The fake only gets this far by reading a well-formed `zINSTREAM\0` followed by
            // big-endian length-prefixed chunks and a zero terminator, so reassembling the exact
            // bytes is the protocol assertion.
            assertThat(clamd.payload()).isEqualTo(PDF);
            assertThat(clamd.chunkCount()).isEqualTo(1);
        }
    }

    @Test
    @DisplayName("a FOUND reply rejects the file without echoing the signature name")
    void rejectsAFoundReplyAndKeepsTheSignatureNameOutOfTheResponse() throws Exception {
        try (FakeClamd clamd = new FakeClamd("stream: Eicar-Test-Signature FOUND")) {
            Verdict verdict = scannerFor(clamd.port()).scan("deed.pdf", "application/pdf", PDF);

            assertThat(verdict.outcome()).isEqualTo(Outcome.REJECTED);
            // A signature name in the body is a free oracle: it tells someone probing the vault with
            // mutated payloads exactly which mutation got closest.
            assertThat(verdict.detail()).doesNotContain("Eicar").contains("virus scanner");
        }
    }

    @Test
    @DisplayName("a file larger than one chunk arrives whole, in several chunks")
    void chunksALargePayload() throws Exception {
        // Deliberately full of zero bytes: a naive framing that stopped at "four zeros in a row"
        // would truncate this, and a truncated file is one clamd would call clean.
        byte[] large = new byte[10_000];
        System.arraycopy(PDF, 0, large, 0, PDF.length);

        try (FakeClamd clamd = new FakeClamd("stream: OK")) {
            ClamAvScanner scanner = new ClamAvScanner("127.0.0.1", clamd.port(), 2000, 4096);
            assertThat(scanner.scan("deed.pdf", "application/pdf", large).isClean()).isTrue();

            assertThat(clamd.payload()).isEqualTo(large);
            assertThat(clamd.chunkCount()).isEqualTo(3); // 4096 + 4096 + 1808
        }
    }
}
