package com.draazy.api.catalog.photo;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.catalog.property.PhotoHash;
import com.draazy.api.provider.FileStorage;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

class PhotoServiceTest {

    @Test
    void storesStrippedBytes() {
        CapturingStorage storage = new CapturingStorage();
        PhotoService service = new PhotoService(storage, new PhotoKeys("test-secret"));
        byte[] jpeg = jpeg(
                segment(0xE1, "Exif\0\0GPS=home".getBytes(StandardCharsets.ISO_8859_1)),
                segment(0xDA, new byte[] {0, 0}),
                new byte[] {1, 2, 3, (byte) 0xFF, (byte) 0xD9});

        PhotoDto dto = service.upload(UUID.randomUUID(),
                new MockMultipartFile("file", "room.jpg", "image/jpeg", jpeg));

        assertThat(dto.url()).isEqualTo("/cdn/" + storage.key);
        assertThat(storage.contentType).isEqualTo("image/jpeg");
        assertThat(new String(storage.content, StandardCharsets.ISO_8859_1))
                .doesNotContain("Exif", "GPS=home");
        assertThat(storage.content).endsWith(new byte[] {1, 2, 3, (byte) 0xFF, (byte) 0xD9});
    }

    @Test
    void aDecodableUploadCarriesItsServerComputedHashInTheKey() throws Exception {
        CapturingStorage storage = new CapturingStorage();
        PhotoService service = new PhotoService(storage, new PhotoKeys("test-secret"));
        byte[] png = encode(scene(800, 600), "png");

        PhotoDto dto = service.upload(UUID.randomUUID(),
                new MockMultipartFile("file", "room.png", "image/png", png));

        List<String> hashes = PhotoHash.fromGallery(List.of(dto.url()));
        assertThat(hashes).hasSize(1);
        long original = PhotoHash.parse(hashes.get(0));
        long reshot = PhotoHash.compute(encode(scene(400, 300), "jpg"));
        long other = PhotoHash.compute(encode(flipped(scene(800, 600)), "png"));
        assertThat(PhotoHash.sameShot(original, reshot)).as("a resized re-encode is the same shot").isTrue();
        assertThat(PhotoHash.sameShot(original, other)).as("a different picture is not").isFalse();
    }

    @Test
    void anUndecodableUploadIsStoredWithoutAHash() {
        CapturingStorage storage = new CapturingStorage();
        byte[] jpeg = jpeg(segment(0xDA, new byte[] {0, 0}), new byte[] {1, 2, 3, (byte) 0xFF, (byte) 0xD9});

        PhotoDto dto = new PhotoService(storage, new PhotoKeys("test-secret")).upload(UUID.randomUUID(),
                new MockMultipartFile("file", "room.jpg", "image/jpeg", jpeg));

        assertThat(PhotoHash.fromGallery(List.of(dto.url()))).isEmpty();
        assertThat(storage.stored).as("no card copies, and the upload still succeeds").hasSize(1);
    }

    @Test
    void cardSizeJpegCopiesAreStoredBesideTheOriginalBeforeItsUrlIsReturned() throws Exception {
        CapturingStorage storage = new CapturingStorage();
        byte[] png = encode(scene(2400, 1600), "png");

        PhotoDto dto = new PhotoService(storage, new PhotoKeys("test-secret")).upload(UUID.randomUUID(),
                new MockMultipartFile("file", "room.png", "image/png", png));

        String original = storage.key;
        assertThat(dto.url()).isEqualTo("/cdn/" + original);
        assertThat(storage.stored.keySet()).containsExactly(
                original + ".w960.jpg", original + ".w480.jpg", original);
        assertThat(storage.types.get(original + ".w480.jpg")).isEqualTo("image/jpeg");
        assertThat(widthOf(storage.stored.get(original + ".w960.jpg"))).isEqualTo(960);
        BufferedImage small = ImageIO.read(new ByteArrayInputStream(storage.stored.get(original + ".w480.jpg")));
        assertThat(small.getWidth()).isEqualTo(480);
        assertThat(small.getHeight()).isEqualTo(320);
    }

    @Test
    void aCopyIsNeverWiderThanTheOriginal() throws Exception {
        CapturingStorage storage = new CapturingStorage();

        new PhotoService(storage, new PhotoKeys("test-secret")).upload(UUID.randomUUID(),
                new MockMultipartFile("file", "room.png", "image/png", encode(scene(600, 400), "png")));

        assertThat(widthOf(storage.stored.get(storage.key + ".w960.jpg"))).isEqualTo(600);
        assertThat(widthOf(storage.stored.get(storage.key + ".w480.jpg"))).isEqualTo(480);
    }

    private static int widthOf(byte[] image) throws Exception {
        return ImageIO.read(new ByteArrayInputStream(image)).getWidth();
    }

    @Test
    void aTallNarrowPhotoIsSubsampledOnBothAxesButKeepsItsShape() throws Exception {
        CapturingStorage storage = new CapturingStorage();

        new PhotoService(storage, new PhotoKeys("test-secret")).upload(UUID.randomUUID(),
                new MockMultipartFile("file", "tower.png", "image/png", encode(scene(1200, 9000), "png")));

        BufferedImage card = ImageIO.read(new ByteArrayInputStream(storage.stored.get(storage.key + ".w480.jpg")));
        assertThat(card.getWidth()).isEqualTo(480);
        assertThat(card.getHeight()).isBetween(3590, 3610);
    }

    @Test
    void anUploadKeyNamesNoUserButStillProvesItsUploader() {
        PhotoKeys keys = new PhotoKeys("test-secret");
        UUID owner = UUID.randomUUID();
        String key = keys.newKey(owner);

        assertThat(key).doesNotContain(owner.toString());
        assertThat(keys.uploadedBy(key + "-00ff00ff00ff00ff", List.of(owner))).isTrue();
        assertThat(keys.uploadedBy(key, List.of(UUID.randomUUID()))).isFalse();
        assertThat(new PhotoKeys("other-secret").uploadedBy(key, List.of(owner))).isFalse();
        assertThat(keys.uploadedBy("photos/" + owner + "/" + UUID.randomUUID(), List.of(owner)))
                .as("a pre-tag key still names its owner").isTrue();
    }

    @Test
    void onlyKeysThisServiceWroteYieldAHash() {
        String owner = UUID.randomUUID().toString();
        String uuid = UUID.randomUUID().toString();
        assertThat(PhotoHash.fromGallery(Arrays.asList(
                "https://cdn.draazy.in/photos/" + owner + "/" + uuid + "-00ff00ff00ff00ff",
                "/dev/storage/public/photos/" + owner + "/" + uuid,
                "https://images.example.com/flat-00ff00ff00ff00ff",
                null)))
                .containsExactly("00ff00ff00ff00ff");
        assertThat(PhotoHash.fromGallery(null)).isNull();
    }

    private static BufferedImage scene(int w, int h) {
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, w, h);
        g.setColor(Color.DARK_GRAY);
        g.fillRect(0, 0, w / 3, h);
        g.fillRect(w / 2, h / 2, w / 2, h / 2);
        g.dispose();
        return img;
    }

    private static BufferedImage flipped(BufferedImage src) {
        BufferedImage img = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.drawImage(src, src.getWidth(), 0, -src.getWidth(), src.getHeight(), null);
        g.dispose();
        return img;
    }

    private static byte[] encode(BufferedImage img, String format) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, format, out);
        return out.toByteArray();
    }

    private static byte[] jpeg(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
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

    private static final class CapturingStorage implements FileStorage {
        private final Map<String, byte[]> stored = new LinkedHashMap<>();
        private final Map<String, String> types = new LinkedHashMap<>();
        private String key;
        private byte[] content;
        private String contentType;

        @Override
        public void store(String key, byte[] content, String contentType) {
            throw new UnsupportedOperationException();
        }

        @Override
        public String signedUploadUrl(String key) {
            throw new UnsupportedOperationException();
        }

        @Override
        public String signedDownloadUrl(String key) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void delete(String key) {
            throw new UnsupportedOperationException();
        }

        @Override
        public String storePublic(String key, byte[] content, String contentType) {
            stored.put(key, content);
            types.put(key, contentType);
            this.key = key;
            this.content = content;
            this.contentType = contentType;
            return "/cdn/" + key;
        }

        @Override
        public String publicUrlPrefix() {
            return "/cdn/";
        }
    }
}
