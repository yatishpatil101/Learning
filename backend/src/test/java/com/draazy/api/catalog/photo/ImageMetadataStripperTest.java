package com.draazy.api.catalog.photo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

import com.draazy.api.common.error.UnsupportedMediaTypeException;
import com.draazy.api.common.validation.MediaSignatures;
import java.awt.color.ColorSpace;
import java.awt.color.ICC_Profile;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.CRC32;
import java.util.zip.DeflaterOutputStream;
import java.util.zip.InflaterInputStream;
import org.junit.jupiter.api.Test;

class ImageMetadataStripperTest {

    @Test
    void removesJpegApp1App13AndCommentSegments() {
        byte[] jpeg = jpeg(
                segment(0xE0, "JFIF\0\1\2\0\0\1\0\1\0\0".getBytes(StandardCharsets.ISO_8859_1)),
                segment(0xE1, "Exif\0\0GPS=home".getBytes(StandardCharsets.ISO_8859_1)),
                segment(0xED, "IPTC=home".getBytes(StandardCharsets.ISO_8859_1)),
                segment(0xFE, "camera comment".getBytes(StandardCharsets.ISO_8859_1)),
                segment(0xDA, new byte[] {0, 0}),
                new byte[] {1, 2, 3, (byte) 0xFF, 0, 4, (byte) 0xFF, (byte) 0xD9});

        byte[] stripped = ImageMetadataStripper.strip(MediaSignatures.JPEG, jpeg);

        assertThat(containsSequence(stripped, (byte) 0xFF, (byte) 0xE1)).isFalse();
        assertThat(containsSequence(stripped, (byte) 0xFF, (byte) 0xED)).isFalse();
        assertThat(containsSequence(stripped, (byte) 0xFF, (byte) 0xFE)).isFalse();
        assertThat(asLatin1(stripped)).doesNotContain("Exif", "GPS=home", "IPTC=home", "camera comment");
        assertThat(stripped).containsSubsequence((byte) 0xFF, (byte) 0xE0, 0, 16, 'J', 'F', 'I', 'F', 0);
        assertThat(stripped).endsWith(new byte[] {1, 2, 3, (byte) 0xFF, 0, 4, (byte) 0xFF, (byte) 0xD9});
    }

    @Test
    void removesPngMetadataChunksWithoutTouchingImageData() {
        byte[] idat = chunk("IDAT", new byte[] {9, 8, 7});
        byte[] png = png(
                chunk("IHDR", new byte[13]),
                chunk("tEXt", "GPS=home".getBytes(StandardCharsets.ISO_8859_1)),
                chunk("eXIf", "Exif\0\0gps".getBytes(StandardCharsets.ISO_8859_1)),
                idat,
                chunk("iTXt", "comment".getBytes(StandardCharsets.ISO_8859_1)),
                chunk("IEND", new byte[0]));

        byte[] stripped = ImageMetadataStripper.strip(MediaSignatures.PNG, png);

        assertThat(asLatin1(stripped)).doesNotContain("tEXt", "eXIf", "iTXt", "GPS=home", "comment");
        assertThat(stripped).containsSubsequence(idat);
    }

    @Test
    void refusesAJpegItCannotWalk_ratherThanStoringItsMetadata() {
        byte[] malformed = {
                (byte) 0xFF, (byte) 0xD8,
                (byte) 0xFF, (byte) 0xE1, 0x7F, 0x7F, 'G', 'P', 'S'
        };

        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> ImageMetadataStripper.strip(MediaSignatures.JPEG, malformed));
    }

    @Test
    void refusesAPngItCannotWalk_ratherThanStoringItsMetadata() {
        byte[] malformed = png(new byte[] {0, 0, 0, 20, 't', 'E', 'X', 't', 'G', 'P', 'S'});

        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> ImageMetadataStripper.strip(MediaSignatures.PNG, malformed));
    }

    @Test
    void refusesAJpegWhoseScanNeverEnds() {
        byte[] truncated = jpeg(segment(0xDA, new byte[] {0, 0}), new byte[] {1, 2, 3});

        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> ImageMetadataStripper.strip(MediaSignatures.JPEG, truncated));
    }

    @Test
    void refusesAPngWithoutIend() {
        byte[] truncated = png(chunk("IHDR", new byte[13]), chunk("IDAT", new byte[] {1}));

        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> ImageMetadataStripper.strip(MediaSignatures.PNG, truncated));
    }

    @Test
    void refusesAnyOtherFormat() {
        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> ImageMetadataStripper.strip(MediaSignatures.HEIC, new byte[] {1, 2, 3}));
    }

    @Test
    void dropsAMotionPhotoOrMpfImageAfterEoi() {
        byte[] trailer = "\0\0\0\u0018ftypmp42 home video".getBytes(StandardCharsets.ISO_8859_1);
        byte[] jpeg = jpeg(
                segment(0xE0, "JFIF\0".getBytes(StandardCharsets.US_ASCII)),
                segment(0xDA, new byte[] {0, 0}),
                new byte[] {1, 2, (byte) 0xFF, (byte) 0xD9},
                trailer);

        byte[] stripped = ImageMetadataStripper.strip(MediaSignatures.JPEG, jpeg);

        assertThat(stripped).endsWith(new byte[] {1, 2, (byte) 0xFF, (byte) 0xD9});
        assertThat(asLatin1(stripped)).doesNotContain("ftypmp42", "home video");
    }

    @Test
    void dropsApp3App11AndMpfButKeepsTheIccProfile() {
        byte[] profile = ICC_PROFILE_FIXTURE.clone();
        byte[] jpeg = jpeg(
                segment(0xE2, iccPayload(1, 1, profile)),
                segment(0xE2, "MPF\0index".getBytes(StandardCharsets.ISO_8859_1)),
                segment(0xE3, "APP3 stereo".getBytes(StandardCharsets.ISO_8859_1)),
                segment(0xEB, "JUMBF c2pa".getBytes(StandardCharsets.ISO_8859_1)),
                segment(0xDA, new byte[] {0, 0}),
                new byte[] {7, (byte) 0xFF, (byte) 0xD9});

        byte[] stripped = ImageMetadataStripper.strip(MediaSignatures.JPEG, jpeg);

        assertThat(stripped).containsSequence(segment(0xE2, iccPayload(1, 1, IccProfileScrubber.scrub(profile))));
        assertThat(asLatin1(stripped)).doesNotContain("MPF", "APP3 stereo", "JUMBF");
    }

    @Test
    void removesDeviceIdentityFromAJpegIccProfileButKeepsItsColour() throws Exception {
        byte[] profile = deviceProfile();
        int half = profile.length / 2;
        byte[] jpeg = jpeg(
                segment(0xE2, iccPayload(1, 2, Arrays.copyOfRange(profile, 0, half))),
                segment(0xE2, iccPayload(2, 2, Arrays.copyOfRange(profile, half, profile.length))),
                segment(0xDA, new byte[] {0, 0}),
                new byte[] {7, (byte) 0xFF, (byte) 0xD9});

        byte[] stripped = ImageMetadataStripper.strip(MediaSignatures.JPEG, jpeg);

        byte[] kept = embeddedProfile(stripped);
        assertThat(asLatin1(stripped)).doesNotContain("Hewlett", "IEC61966", "AcmeCam9", "Mod9", "Packard");
        assertThat(kept[48]).isZero();
        assertThat(Arrays.copyOfRange(kept, 80, 84)).containsOnly(0);
        ICC_Profile original = ICC_Profile.getInstance(profile);
        ICC_Profile scrubbed = ICC_Profile.getInstance(kept);
        for (int tag : new int[] {ICC_Profile.icSigRedColorantTag, ICC_Profile.icSigGreenColorantTag,
                ICC_Profile.icSigBlueColorantTag, ICC_Profile.icSigMediaWhitePointTag,
                ICC_Profile.icSigRedTRCTag, ICC_Profile.icSigGreenTRCTag, ICC_Profile.icSigBlueTRCTag}) {
            assertThat(scrubbed.getData(tag)).isEqualTo(original.getData(tag));
        }
        assertThat(scrubbed.getColorSpaceType()).isEqualTo(original.getColorSpaceType());
        assertThat(asLatin1(scrubbed.getData(ICC_Profile.icSigProfileDescriptionTag))).doesNotContain("sRGB");
    }

    @Test
    void dropsAMalformedJpegIccProfile() {
        byte[] jpeg = jpeg(
                segment(0xE2, iccPayload(1, 1, "not a profile, Model9".getBytes(StandardCharsets.ISO_8859_1))),
                segment(0xDA, new byte[] {0, 0}),
                new byte[] {7, (byte) 0xFF, (byte) 0xD9});

        assertThat(asLatin1(ImageMetadataStripper.strip(MediaSignatures.JPEG, jpeg)))
                .doesNotContain("ICC_PROFILE", "Model9");
    }

    @Test
    void dropsAnIccProfileWithAMissingPart() {
        byte[] jpeg = jpeg(
                segment(0xE2, iccPayload(2, 2, deviceProfile())),
                segment(0xDA, new byte[] {0, 0}),
                new byte[] {7, (byte) 0xFF, (byte) 0xD9});

        assertThat(asLatin1(ImageMetadataStripper.strip(MediaSignatures.JPEG, jpeg))).doesNotContain("ICC_PROFILE");
    }

    @Test
    void cutsPaddingAndThumbnailsOffJfifAndAdobeSegments() {
        byte[] jpeg = jpeg(
                segment(0xE0, concat("JFIF\0\1\2\0\0\1\0\1\2\2".getBytes(StandardCharsets.ISO_8859_1),
                        "thumbnail GPS=home".getBytes(StandardCharsets.ISO_8859_1))),
                segment(0xEE, concat("Adobe\0d\0\0\0\0\1".getBytes(StandardCharsets.ISO_8859_1),
                        "padding Model9".getBytes(StandardCharsets.ISO_8859_1))),
                segment(0xDA, new byte[] {0, 0}),
                new byte[] {7, (byte) 0xFF, (byte) 0xD9});

        byte[] stripped = ImageMetadataStripper.strip(MediaSignatures.JPEG, jpeg);

        assertThat(asLatin1(stripped)).doesNotContain("thumbnail", "GPS=home", "padding", "Model9");
        assertThat(stripped).containsSequence(
                segment(0xE0, "JFIF\0\1\2\0\0\1\0\1\0\0".getBytes(StandardCharsets.ISO_8859_1)));
        assertThat(stripped).containsSequence(
                segment(0xEE, "Adobe\0d\0\0\0\0\1".getBytes(StandardCharsets.ISO_8859_1)));
    }

    @Test
    void removesDeviceIdentityFromAPngIccProfileButKeepsItsColour() throws Exception {
        byte[] profile = deviceProfile();
        ByteArrayOutputStream iccp = new ByteArrayOutputStream();
        iccp.writeBytes("Acme Camera ProfileX\0\0".getBytes(StandardCharsets.ISO_8859_1));
        try (DeflaterOutputStream z = new DeflaterOutputStream(iccp)) {
            z.write(profile);
        }
        byte[] png = png(chunk("IHDR", new byte[13]), chunk("iCCP", iccp.toByteArray()),
                chunk("IDAT", new byte[] {1}), chunk("IEND", new byte[0]));

        byte[] stripped = ImageMetadataStripper.strip(MediaSignatures.PNG, png);

        assertThat(asLatin1(stripped)).doesNotContain("Acme", "ProfileX");
        int at = indexOf(stripped, "iCCP".getBytes(StandardCharsets.US_ASCII));
        int length = ByteBuffer.wrap(stripped, at - 4, 4).getInt();
        byte[] data = Arrays.copyOfRange(stripped, at + 4, at + 4 + length);
        CRC32 crc = new CRC32();
        crc.update(stripped, at, 4 + length);
        assertThat(ByteBuffer.wrap(stripped, at + 4 + length, 4).getInt()).isEqualTo((int) crc.getValue());
        assertThat(new String(data, 0, 3, StandardCharsets.US_ASCII)).isEqualTo("icc");
        byte[] kept = new InflaterInputStream(new ByteArrayInputStream(data, 5, data.length - 5)).readAllBytes();
        assertThat(asLatin1(kept)).doesNotContain("Hewlett", "IEC61966", "AcmeCam9", "Mod9");
        assertThat(ICC_Profile.getInstance(kept).getData(ICC_Profile.icSigRedColorantTag))
                .isEqualTo(ICC_Profile.getInstance(profile).getData(ICC_Profile.icSigRedColorantTag));
    }

    @Test
    void dropsAPngIccProfileItCannotInflate() {
        byte[] png = png(chunk("IHDR", new byte[13]),
                chunk("iCCP", "Model9\0\0garbage".getBytes(StandardCharsets.ISO_8859_1)),
                chunk("IDAT", new byte[] {1}), chunk("IEND", new byte[0]));

        assertThat(asLatin1(ImageMetadataStripper.strip(MediaSignatures.PNG, png)))
                .doesNotContain("iCCP", "Model9");
    }

    @Test
    void dropsEveryOtherAppSegment_keepingOnlyJfifIccAndAdobeColour() {
        byte[] adobe = segment(0xEE, "Adobe\0d\0\0\0\0\1".getBytes(StandardCharsets.ISO_8859_1));
        byte[] jpeg = jpeg(
                segment(0xE0, "JFXX thumbnail".getBytes(StandardCharsets.ISO_8859_1)),
                segment(0xE6, "GPMF GPS=home".getBytes(StandardCharsets.ISO_8859_1)),
                segment(0xE5, "RMETA".getBytes(StandardCharsets.ISO_8859_1)),
                segment(0xEC, "Ducky".getBytes(StandardCharsets.ISO_8859_1)),
                adobe,
                segment(0xDA, new byte[] {0, 0}),
                new byte[] {7, (byte) 0xFF, (byte) 0xD9});

        byte[] stripped = ImageMetadataStripper.strip(MediaSignatures.JPEG, jpeg);

        assertThat(stripped).containsSubsequence(adobe);
        assertThat(asLatin1(stripped)).doesNotContain("JFXX", "GPMF", "GPS=home", "RMETA", "Ducky");
    }

    @Test
    void refusesAJpegMarkerThatIsNotImageStructure() {
        byte[] jpeg = jpeg(
                segment(0xF0, "JPG0 payload".getBytes(StandardCharsets.ISO_8859_1)),
                segment(0xDA, new byte[] {0, 0}),
                new byte[] {7, (byte) 0xFF, (byte) 0xD9});

        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> ImageMetadataStripper.strip(MediaSignatures.JPEG, jpeg));
    }

    @Test
    void keepsOnlyRenderingPngChunks() {
        byte[] ihdr = chunk("IHDR", new byte[13]);
        byte[] srgb = chunk("sRGB", new byte[] {0});
        byte[] idat = chunk("IDAT", new byte[] {9, 8, 7});
        byte[] iend = chunk("IEND", new byte[0]);
        byte[] png = png(
                ihdr,
                srgb,
                chunk("caBX", "c2pa GPS=home".getBytes(StandardCharsets.ISO_8859_1)),
                chunk("exIf", "old exif".getBytes(StandardCharsets.ISO_8859_1)),
                chunk("prVt", "anything".getBytes(StandardCharsets.ISO_8859_1)),
                idat,
                iend);

        assertThat(ImageMetadataStripper.strip(MediaSignatures.PNG, png)).isEqualTo(png(ihdr, srgb, idat, iend));
    }

    @Test
    void refusesAPngThatDoesNotStartWithIhdr() {
        byte[] png = png(chunk("tEXt", "GPS=home".getBytes(StandardCharsets.ISO_8859_1)),
                chunk("IHDR", new byte[13]), chunk("IDAT", new byte[] {1}), chunk("IEND", new byte[0]));

        assertThatExceptionOfType(UnsupportedMediaTypeException.class)
                .isThrownBy(() -> ImageMetadataStripper.strip(MediaSignatures.PNG, png));
    }

    @Test
    void keepsEveryScanOfAProgressiveJpeg() {
        byte[] dht = segment(0xC4, new byte[] {0, 1});
        byte[] jpeg = jpeg(
                segment(0xDA, new byte[] {0, 0}),
                new byte[] {1, (byte) 0xFF, 0, (byte) 0xFF, (byte) 0xD0, 2},
                dht,
                segment(0xDA, new byte[] {0, 0}),
                new byte[] {3, (byte) 0xFF, (byte) 0xD9});

        assertThat(ImageMetadataStripper.strip(MediaSignatures.JPEG, jpeg)).isEqualTo(jpeg);
    }

    @Test
    void dropsBytesAfterIend() {
        byte[] whole = png(chunk("IHDR", new byte[13]), chunk("IDAT", new byte[] {1}), chunk("IEND", new byte[0]));
        byte[] padded = Arrays.copyOf(whole, whole.length + 7);

        assertThat(ImageMetadataStripper.strip(MediaSignatures.PNG, padded)).isEqualTo(whole);
    }

    private static final byte[] ICC_PROFILE_FIXTURE = deviceProfile();

    // The JDK's own sRGB profile carries Hewlett-Packard description, copyright and device tags; the
    // header gets a manufacturer, model and creator the way a camera's profile would.
    private static byte[] deviceProfile() {
        byte[] profile = ICC_Profile.getInstance(ColorSpace.CS_sRGB).getData();
        System.arraycopy("AcmeCam9".getBytes(StandardCharsets.US_ASCII), 0, profile, 48, 8);
        System.arraycopy("Mod9".getBytes(StandardCharsets.US_ASCII), 0, profile, 80, 4);
        return profile;
    }

    private static byte[] iccPayload(int sequence, int count, byte[] part) {
        return concat("ICC_PROFILE\0".getBytes(StandardCharsets.US_ASCII), new byte[] {(byte) sequence, (byte) count}, part);
    }

    private static byte[] embeddedProfile(byte[] jpeg) {
        ByteArrayOutputStream profile = new ByteArrayOutputStream();
        int i = 2;
        while (jpeg[i + 1] != (byte) 0xDA) {
            int length = ((jpeg[i + 2] & 0xFF) << 8) | (jpeg[i + 3] & 0xFF);
            if (jpeg[i + 1] == (byte) 0xE2) {
                profile.write(jpeg, i + 2 + 2 + 14, length - 2 - 14);
            }
            i += 2 + length;
        }
        return profile.toByteArray();
    }

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] part : parts) {
            out.writeBytes(part);
        }
        return out.toByteArray();
    }

    private static int indexOf(byte[] haystack, byte[] needle) {
        for (int i = 0; i <= haystack.length - needle.length; i++) {
            if (Arrays.equals(haystack, i, i + needle.length, needle, 0, needle.length)) {
                return i;
            }
        }
        return -1;
    }

    private static byte[] jpeg(byte[]... parts) {        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(new byte[] {(byte) 0xFF, (byte) 0xD8});
        for (byte[] part : parts) {
            out.writeBytes(part);
        }
        return out.toByteArray();
    }

    private static byte[] segment(int marker, byte[] payload) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0xFF);
        out.write(marker);
        int length = payload.length + 2;
        out.write((length >>> 8) & 0xFF);
        out.write(length & 0xFF);
        out.writeBytes(payload);
        return out.toByteArray();
    }

    private static byte[] png(byte[]... chunks) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A});
        for (byte[] chunk : chunks) {
            out.writeBytes(chunk);
        }
        return out.toByteArray();
    }

    private static byte[] chunk(String type, byte[] payload) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int length = payload.length;
        out.write((length >>> 24) & 0xFF);
        out.write((length >>> 16) & 0xFF);
        out.write((length >>> 8) & 0xFF);
        out.write(length & 0xFF);
        out.writeBytes(type.getBytes(StandardCharsets.US_ASCII));
        out.writeBytes(payload);
        out.writeBytes(new byte[] {0, 0, 0, 0});
        return out.toByteArray();
    }

    private static String asLatin1(byte[] bytes) {
        return new String(bytes, StandardCharsets.ISO_8859_1);
    }

    private static boolean containsSequence(byte[] haystack, byte... needle) {
        for (int i = 0; i <= haystack.length - needle.length; i++) {
            boolean match = true;
            for (int j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                return true;
            }
        }
        return false;
    }
}
