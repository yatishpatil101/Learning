package com.punenest.api.provider;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.support.AbstractApiTest;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;

/**
 * Dev document bytes actually resolve (D120).
 *
 * <p>{@code MockFileStorage} has always written uploads to a real directory, but the URL it handed
 * back pointed at {@code https://mock.storage.local/} — a host that does not exist. Every document
 * the API returned in dev therefore carried a {@code url} nothing could open, and the service
 * tracker's preview could not be demonstrated without real R2 credentials.
 *
 * <p>This asserts the seam, not the wiring: bytes go in, a URL comes out, and following that URL
 * with no session returns the same bytes with the content type they were stored under. The three
 * ways it must <em>not</em> work — a forged signature, a tampered key, a lapsed deadline — are the
 * reason it is safe for the URL to be openable without a token at all.
 */
@DisplayName("D120 — dev storage serves the bytes it stored")
class DevStorageTest extends AbstractApiTest {

    @Autowired
    FileStorage storage;

    /**
     * The minted URL is absolute and carries the servlet context path, because a browser has to be
     * able to paste it. MockMvc dispatches without one, so it comes off here — stripping the
     * configured value rather than a hardcoded string, so this does not quietly stop testing the
     * real path if the context path ever moves.
     */
    @Value("${server.servlet.context-path:}")
    String contextPath;

    private String pathAndQuery(String url) {
        URI uri = URI.create(url);
        String path = uri.getRawPath();
        if (!contextPath.isEmpty() && path.startsWith(contextPath)) {
            path = path.substring(contextPath.length());
        }
        return path + "?" + uri.getRawQuery();
    }

    /**
     * Would fail if: the download URL went back to pointing at a host outside this application, or
     * the content type were dropped — in which case the browser downloads the document instead of
     * previewing it, which is the behaviour this row exists to fix.
     */
    @Test
    @DisplayName("a signed download URL returns the stored bytes, with their content type")
    void signedUrlResolvesToTheBytes() throws Exception {
        String key = "documents/" + UUID.randomUUID() + "/" + UUID.randomUUID();
        storage.store(key, "%PDF-1.4 hello".getBytes(StandardCharsets.UTF_8), "application/pdf");

        String url = storage.signedDownloadUrl(key);
        assertThat(url).doesNotContain("mock.storage.local").contains(key);

        // No Authorization header: a signed URL is opened by an <img> tag or a new tab, neither of
        // which can send one. The signature in the query string is the whole credential.
        mvc.perform(get(pathAndQuery(url)))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("application/pdf"))
                .andExpect(content().bytes("%PDF-1.4 hello".getBytes(StandardCharsets.UTF_8)));
    }

    /**
     * The credential has to be the signature rather than the key, or "openable without a token"
     * would mean "openable by anyone who can guess a UUID pair".
     *
     * <p>Would fail if: the controller served the file before checking the signature, or checked it
     * over the expiry alone so any key could be swapped into a valid-looking URL.
     */
    @Test
    @DisplayName("a forged signature, a swapped key and a lapsed deadline are all 404")
    void onlyAValidSignatureOpensIt() throws Exception {
        String key = "documents/" + UUID.randomUUID() + "/" + UUID.randomUUID();
        String other = "documents/" + UUID.randomUUID() + "/" + UUID.randomUUID();
        storage.store(key, "one".getBytes(StandardCharsets.UTF_8), "application/pdf");
        storage.store(other, "two".getBytes(StandardCharsets.UTF_8), "application/pdf");

        String signed = pathAndQuery(storage.signedDownloadUrl(key));
        String query = signed.substring(signed.indexOf('?'));

        // Right shape, wrong signature.
        mvc.perform(get(signed.substring(0, signed.lastIndexOf("&sig=")) + "&sig=deadbeef"))
                .andExpect(status().isNotFound());

        // A real signature, pointed at a different object.
        mvc.perform(get("/dev/storage/" + other + query))
                .andExpect(status().isNotFound());

        // Signed for a moment that has passed. The expiry is covered by the signature, so moving it
        // invalidates the URL twice over.
        mvc.perform(get("/dev/storage/" + key + "?exp=1&sig=deadbeef"))
                .andExpect(status().isNotFound());
    }

    /**
     * The sidecar that carries the content type must not itself be fetchable. It is an
     * implementation detail of "a directory has no object metadata", not an object.
     */
    @Test
    @DisplayName("the content-type sidecar is not an object")
    void sidecarIsNotServed() throws Exception {
        String key = "documents/" + UUID.randomUUID() + "/" + UUID.randomUUID();
        storage.store(key, "one".getBytes(StandardCharsets.UTF_8), "application/pdf");

        String signed = pathAndQuery(storage.signedDownloadUrl(key));
        String query = signed.substring(signed.indexOf('?'));
        mvc.perform(get("/dev/storage/" + key + ".contenttype" + query))
                .andExpect(status().isNotFound());
    }
}
