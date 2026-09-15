package com.draazy.api.catalog.photo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.error.UnsupportedMediaTypeException;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

/** Public uploads must prove their type independently of the uploader's label. */
class PhotoUploadsTest {

    private static final byte[] PNG_MAGIC =
            {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};
    private static final byte[] JPEG_MAGIC = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 0, 0, 0};

    private static byte[] iso(String brand) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(new byte[] {0, 0, 0, 0x20});
        out.writeBytes("ftyp".getBytes(StandardCharsets.US_ASCII));
        out.writeBytes(brand.getBytes(StandardCharsets.US_ASCII));
        out.writeBytes(new byte[] {0, 0, 0, 0});
        return out.toByteArray();
    }

    private static byte[] webp() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes("RIFF".getBytes(StandardCharsets.US_ASCII));
        out.writeBytes(new byte[] {0, 0, 0, 0});
        out.writeBytes("WEBP".getBytes(StandardCharsets.US_ASCII));
        return out.toByteArray();
    }

    @Test
    void acceptsPng() {
        assertThat(PhotoUploads.validate("image/png", PNG_MAGIC.length, PNG_MAGIC))
                .isEqualTo("image/png");
    }

    @Test
    void acceptsJpeg() {
        assertThat(PhotoUploads.validate("image/jpeg", JPEG_MAGIC.length, JPEG_MAGIC))
                .isEqualTo("image/jpeg");
    }

    @ParameterizedTest
    @ValueSource(strings = {"image/webp", "image/png", "image/jpeg", "image/heic", "image/heif"})
    void refusesWebpEvenWhenMislabelled(String declared) {
        byte[] b = webp();
        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> PhotoUploads.validate(declared, b.length, b));
    }

    @Test
    void acceptsHeic() {
        byte[] b = iso("heic");
        assertThat(PhotoUploads.validate("image/heic", b.length, b)).isEqualTo("image/heic");
    }

    @Test
    void acceptsHeicBytesDeclaredAsHeif_becauseBrowsersLabelHeifEitherWay() {
        byte[] b = iso("mif1");
        assertThat(PhotoUploads.validate("image/heif", b.length, b)).isEqualTo("image/heic");
    }

    @ParameterizedTest
    @ValueSource(strings = {"image/avif", "image/png", "image/jpeg", "image/heic", "image/heif"})
    void refusesAvifEvenWhenMislabelled(String declared) {
        byte[] b = iso("avif");
        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> PhotoUploads.validate(declared, b.length, b));
    }

    @Test
    void keepsTheContentTypeParameterOutOfTheComparison() {
        assertThat(PhotoUploads.validate("image/png; charset=binary", PNG_MAGIC.length, PNG_MAGIC))
                .isEqualTo("image/png");
    }

    @Test
    void acceptsJpgAliasAsJpeg() {
        assertThat(PhotoUploads.validate("IMAGE/JPG; charset=binary", JPEG_MAGIC.length, JPEG_MAGIC))
                .isEqualTo("image/jpeg");
    }

    @Test
    void accepts999999Bytes() {
        byte[] content = Arrays.copyOf(PNG_MAGIC, 999_999);
        assertThat(PhotoUploads.validate("image/png", content.length, content)).isEqualTo("image/png");
    }

    @ParameterizedTest
    @ValueSource(longs = {0, 999_999, 1_000_000})
    void refuses1000000ActualBytesRegardlessOfClaim(long claimedSize) {
        byte[] content = Arrays.copyOf(PNG_MAGIC, 1_000_000);
        assertThatExceptionOfType(PayloadTooLargeException.class)
                .isThrownBy(() -> PhotoUploads.validate("image/png", claimedSize, content));
    }

    @Test
    void refuses1000000ClaimedBytesEvenWhenActualContentIsSmall() {
        assertThatExceptionOfType(PayloadTooLargeException.class)
                .isThrownBy(() -> PhotoUploads.validate("image/png", 1_000_000, PNG_MAGIC));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"image/webp", "image/avif"})
    void refusesUnacceptedDeclarationsEvenWithPngBytes(String declared) {
        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> PhotoUploads.validate(declared, PNG_MAGIC.length, PNG_MAGIC));
    }

    @Test
    void refusesNullAndTruncatedContent() {
        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> PhotoUploads.validate("image/png", 0, null));
        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> PhotoUploads.validate("image/png", 3, new byte[3]));
    }

    @Test
    void refusesSvg_theWholePointOfAnImageOnlyAllowlist() {
        byte[] svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>1</script></svg>"
                .getBytes(StandardCharsets.UTF_8);
        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> PhotoUploads.validate("image/svg+xml", svg.length, svg));
    }

    @Test
    void refusesHtmlDisguisedAsPng() {
        byte[] html = "<html><script>alert(1)</script></html>".getBytes(StandardCharsets.UTF_8);
        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> PhotoUploads.validate("image/png", html.length, html));
    }

    @Test
    void refusesPdf_becausePhotosArePublicAndDocumentsAreNot() {
        byte[] pdf = "%PDF-1.4 deed".getBytes(StandardCharsets.UTF_8);
        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> PhotoUploads.validate("application/pdf", pdf.length, pdf));
    }

    @Test
    void refusesPngBytesDeclaredAsJpeg_familyMismatch() {
        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> PhotoUploads.validate("image/jpeg", PNG_MAGIC.length, PNG_MAGIC));
    }

    @Test
    void refusesOversized() {
        assertThatExceptionOfType(PayloadTooLargeException.class)
                .isThrownBy(() -> PhotoUploads.validate(
                        "image/png", PhotoUploads.MAX_BYTES + 1, PNG_MAGIC));
    }

    @Test
    void refusesEmptyOrTruncated() {
        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> PhotoUploads.validate("image/png", 0, new byte[0]));
    }
}
