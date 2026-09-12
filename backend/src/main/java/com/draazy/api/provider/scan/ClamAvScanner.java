package com.draazy.api.provider.scan;

import com.draazy.api.provider.DocumentScanner;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Real malware scanning, by streaming the upload to a {@code clamd} daemon (tech-debt D131).
 *
 * <p><strong>Off unless a daemon is configured.</strong> {@code draazy.providers.clamav.enabled}
 * defaults to absent, and this bean does not exist until it is {@code true} — the same shape as
 * {@link com.draazy.api.provider.storage.R2FileStorage} and for the same reason. A missing
 * configuration value has to land on the behaviour that cannot break the product, and the built-in
 * structural check keeps running either way, so "off" degrades to a weaker guarantee rather than to
 * none.
 *
 * <p><strong>On but unreachable is a refusal, never a pass.</strong> Turning this on is a statement
 * that uploads are scanned. If the daemon is then down, out of memory, or behind a firewall, the
 * only two honest options are to reject the upload or to stop claiming it was scanned — and quietly
 * accepting unscanned files while the dashboard still says "scanned" is how a control becomes
 * theatre. So every failure to complete the conversation raises, the upload 500s, no bytes are
 * stored, and the log line says which daemon and why. That is deliberately loud: an operator who
 * enabled this wants to be paged, and the alternative is a silent window during which everything
 * gets through.
 *
 * <p>The failure is an {@link UncheckedIOException} rather than a typed API error because a new
 * machine-readable error code is published contract surface and belongs in {@code common.error},
 * which is not this seam's decision to make. It matches {@link
 * com.draazy.api.provider.FileStorage#store}'s existing rule that an upload which did not complete
 * is a failure and never a 201. A dedicated 503 {@code scanner_unavailable} would read better to the
 * client and is worth doing when clamd is actually deployed.
 *
 * <p><strong>No dependency.</strong> clamd's {@code INSTREAM} command is a length-prefixed byte
 * stream over a socket, so this is {@link Socket} and two loops. A client library for a protocol
 * this small would be a supply-chain entry and a version to maintain in exchange for nothing.
 */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.clamav", name = "enabled",
        havingValue = "true")
public class ClamAvScanner implements DocumentScanner {

    private static final Logger log = LoggerFactory.getLogger(ClamAvScanner.class);

    /**
     * {@code z} prefix, not {@code n}: it makes the terminator a NUL rather than a newline, which is
     * the only variant safe for binary payloads.
     */
    private static final byte[] INSTREAM = "zINSTREAM\0".getBytes(StandardCharsets.US_ASCII);

    /** Four zero bytes: a zero-length chunk, which is how INSTREAM says "that is the whole file". */
    private static final byte[] END_OF_STREAM = new byte[4];

    /** clamd's own default INSTREAM chunk ceiling is generous; 32 KiB is the conventional size. */
    private final int chunkBytes;
    private final String host;
    private final int port;
    private final int timeoutMs;

    public ClamAvScanner(
            @Value("${draazy.providers.clamav.host:127.0.0.1}") String host,
            @Value("${draazy.providers.clamav.port:3310}") int port,
            @Value("${draazy.providers.clamav.timeout-ms:10000}") int timeoutMs,
            @Value("${draazy.providers.clamav.chunk-bytes:32768}") int chunkBytes) {
        this.host = host;
        this.port = port;
        this.timeoutMs = timeoutMs;
        this.chunkBytes = chunkBytes;
        log.info("ClamAV scanning is ON: uploads will be streamed to clamd at {}:{} "
                + "and REJECTED if it cannot be reached", host, port);
    }

    @Override
    public Verdict scan(String fileName, String contentType, byte[] content) {
        String reply = converse(content);

        // "stream: OK"
        if (reply.endsWith("OK") && !reply.contains("FOUND")) {
            return Verdict.clean();
        }
        // "stream: Eicar-Test-Signature FOUND"
        if (reply.endsWith("FOUND")) {
            // The signature name is logged and never returned. To the uploader it is one sentence;
            // to anyone probing the vault with mutated payloads, a signature name in the response
            // body is a free oracle telling them exactly which mutation got closest.
            log.warn("clamd rejected an upload: signature={} contentType={}", reply, contentType);
            return Verdict.rejected(
                    "That file was rejected by our virus scanner. If you believe this is wrong, "
                            + "re-scan the original document and upload that.");
        }

        // Anything else -- "ERROR", "INSTREAM size limit exceeded", a truncated reply -- means we do
        // not know whether the file is clean. Undecided is not clean.
        throw new UncheckedIOException(new IOException(
                "clamd at " + host + ":" + port + " gave an unusable reply: " + reply));
    }

    /**
     * One complete {@code INSTREAM} exchange: connect, announce, send length-prefixed chunks, send
     * the zero-length terminator, read the NUL-terminated reply.
     *
     * <p>The connect and the read both carry {@link #timeoutMs}. Without the read timeout a clamd
     * that accepts the connection and then wedges would hold an upload thread open forever, which
     * turns a scanner outage into an outage of the whole API.
     */
    private String converse(byte[] content) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), timeoutMs);
            socket.setSoTimeout(timeoutMs);

            try (OutputStream raw = socket.getOutputStream();
                    BufferedOutputStream out = new BufferedOutputStream(raw);
                    InputStream in = socket.getInputStream()) {
                out.write(INSTREAM);
                for (int offset = 0; offset < content.length; offset += chunkBytes) {
                    int length = Math.min(chunkBytes, content.length - offset);
                    out.write(new byte[] {
                            (byte) (length >>> 24), (byte) (length >>> 16),
                            (byte) (length >>> 8), (byte) length});
                    out.write(content, offset, length);
                }
                out.write(END_OF_STREAM);
                out.flush();

                return readReply(in);
            }
        } catch (IOException e) {
            // Fail closed. This is the branch that decides whether "scanning is on" is true.
            log.error("clamd at {}:{} is unreachable -- REJECTING the upload rather than storing an "
                    + "unscanned file. Fix the daemon or set draazy.providers.clamav.enabled=false"
                    + " and accept that only the built-in structural check runs.", host, port, e);
            throw new UncheckedIOException("document scanner unavailable", e);
        }
    }

    /** clamd answers with one NUL-terminated line. */
    private static String readReply(InputStream in) throws IOException {
        var buffer = new java.io.ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1 && b != 0) {
            buffer.write(b);
        }
        if (buffer.size() == 0) {
            throw new IOException("clamd closed the connection without replying");
        }
        return buffer.toString(StandardCharsets.US_ASCII).trim();
    }
}
