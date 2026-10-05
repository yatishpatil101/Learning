package com.draazy.api.catalog.photo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockMultipartFile;

// Listing photos go to the public bucket, so uploads are image-only
// and authenticated without property ownership scope.
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
        return new MockMultipartFile("file", name, "image/png", TinyImages.png());
    }

    @Test
    void uploadsToThePublicBucketAndReturnsAnUnsignedOwnerScopedCdnUrl() throws Exception {
        User owner = user("9822003001");

        String json = mvc.perform(multipart(Routes.MePhotos.BASE)
                        .file(png("living-room.png"))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.url").exists())
                .andReturn().getResponse().getContentAsString();

        assertThat(json).contains(MOCK_PUBLIC + owner.getId() + "/");
        assertThat(json).doesNotContain("sig=");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("refusedUploads")
    void refusesAnythingButARealImage(String name, MockMultipartFile file) throws Exception {
        User owner = user("9822003002");

        mvc.perform(multipart(Routes.MePhotos.BASE)
                        .file(file)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error").value("unsupported_media_type"));
    }

    static Stream<Arguments> refusedUploads() {
        return Stream.of(
                Arguments.of("refusesSvg_becauseThePublicBucketMustNotServeActiveContent",
                        new MockMultipartFile("file", "logo.svg", "image/svg+xml",
                                "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>1</script></svg>"
                                        .getBytes())),
                Arguments.of("refusesHtmlDisguisedAsAPng",
                        new MockMultipartFile("file", "shot.png", "image/png",
                                "<html><script>alert(1)</script></html>".getBytes())),
                Arguments.of("refusesAPdf_becausePhotosArePublicAndDocumentsAreNot",
                        new MockMultipartFile("file", "deed.pdf", "application/pdf",
                                "%PDF-1.4 deed".getBytes())));
    }

    @Test
    void requiresAuthentication() throws Exception {
        mvc.perform(multipart(Routes.MePhotos.BASE).file(png("anon.png")))
                .andExpect(status().isUnauthorized());
    }
}
