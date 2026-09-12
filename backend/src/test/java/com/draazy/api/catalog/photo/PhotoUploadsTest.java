package com.draazy.api.catalog.photo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.error.UnsupportedMediaTypeException;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/**
 * {@link PhotoUploads} — the public bucket's gate. The invariants under test are the ones that keep
 * executable content off a world-readable CDN: the bytes decide the type, not the label, and
 * anything that is not a raster image on the allowlist is refused.
 */
class PhotoUploadsTest {

    private static final byte[] PNG_MAGIC =
            {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};
    private static final byte[] JPEG_MAGIC = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 0, 0, 0};

    private static byte[] iso(String brand) {
        // [4-byte box size][ftyp][4-byte brand] + padding to reach the 12-byte sniff window.
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

    // ---------------- accepted ----------------

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

    @Test
    void acceptsWebp() {
        byte[] b = webp();
        assertThat(PhotoUploads.validate("image/webp", b.length, b)).isEqualTo("image/webp");
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

    @Test
    void acceptsAvif() {
        byte[] b = iso("avif");
        assertThat(PhotoUploads.validate("image/avif", b.length, b)).isEqualTo("image/avif");
    }

    @Test
    void keepsTheContentTypeParameterOutOfTheComparison() {
        assertThat(PhotoUploads.validate("image/png; charset=binary", PNG_MAGIC.length, PNG_MAGIC))
                .isEqualTo("image/png");
    }

    // ---------------- refused ----------------

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
