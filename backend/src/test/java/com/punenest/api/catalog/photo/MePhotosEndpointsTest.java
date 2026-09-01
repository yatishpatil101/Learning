package com.punenest.api.catalog.photo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockMultipartFile;

/**
 * {@code POST /me/photos} — the public photo upload path.
 *
 * <p>Organised around what makes this different from the document vault: the object goes to the
 * <em>public</em> bucket (so the returned URL is an unsigned CDN URL, not a signed one), it is
 * image-only (an SVG or a mislabelled file is refused, because the bucket is world-readable), and it
 * is authenticated but not owner-scoped (there is no property to scope to at upload time).
 *
 * <p>Runs under the {@code dev} profile, so {@code MockFileStorage} is the wired {@link
 * com.punenest.api.provider.FileStorage}: its {@code storePublic} returns a relative
 * {@code /api/dev/storage/public/...} URL served by {@code DevStorageController}, which stands in
 * for the R2 CDN URL that the live test ({@code R2FileStorageLiveTest}) proves against the real
 * bucket. It used to answer on {@code https://mock.storage.local/}, a host that does not resolve,
 * so no photo uploaded in dev could be displayed or hashed (D246).
 */
class MePhotosEndpointsTest extends AbstractApiTest {

    private static final String MOCK_PUBLIC = "/api/dev/storage/public/photos/";

    @Autowired
    UserRepository users;

    private User user(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private static MockMultipartFile png(String name) {
        byte[] pngMagic = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};
        return new MockMultipartFile("file", name, "image/png", pngMagic);
    }

    // ---------------- happy path ----------------

    @Test
    void uploadsToThePublicBucketAndReturnsAnUnsignedOwnerScopedCdnUrl() throws Exception {
        User owner = user("9822003001");

        String json = mvc.perform(multipart(Routes.MePhotos.BASE)
                        .file(png("living-room.png"))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.url").exists())
                .andReturn().getResponse().getContentAsString();

        // The key is server-minted and scoped by owner id; the URL is the public (unsigned) CDN URL,
        // not a signed one — no ?sig= as the private download URLs carry.
        assertThat(json).contains(MOCK_PUBLIC + owner.getId() + "/");
        assertThat(json).doesNotContain("sig=");
    }

    // ---------------- refusals ----------------

    @Test
    void refusesSvg_becauseThePublicBucketMustNotServeActiveContent() throws Exception {
        User owner = user("9822003002");

        mvc.perform(multipart(Routes.MePhotos.BASE)
                        .file(new MockMultipartFile("file", "logo.svg", "image/svg+xml",
                                "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>1</script></svg>"
                                        .getBytes()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error").value("unsupported_media_type"));
    }

    @Test
    void refusesHtmlDisguisedAsAPng() throws Exception {
        User owner = user("9822003003");

        mvc.perform(multipart(Routes.MePhotos.BASE)
                        .file(new MockMultipartFile("file", "shot.png", "image/png",
                                "<html><script>alert(1)</script></html>".getBytes()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error").value("unsupported_media_type"));
    }

    @Test
    void refusesAPdf_becausePhotosArePublicAndDocumentsAreNot() throws Exception {
        User owner = user("9822003004");

        mvc.perform(multipart(Routes.MePhotos.BASE)
                        .file(new MockMultipartFile("file", "deed.pdf", "application/pdf",
                                "%PDF-1.4 deed".getBytes()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isUnsupportedMediaType());
    }

    @Test
    void requiresAuthentication() throws Exception {
        mvc.perform(multipart(Routes.MePhotos.BASE).file(png("anon.png")))
                .andExpect(status().isUnauthorized());
    }
}
