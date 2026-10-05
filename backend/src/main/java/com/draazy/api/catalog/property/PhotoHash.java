package com.draazy.api.catalog.property;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Iterator;
import java.util.List;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

/** Browser computes hashes because decoding pixels belongs to {@code canvas}. */
public final class PhotoHash {

    public static final int THRESHOLD = 10;

    /** 16 hex characters, because the hash is exactly 64 bits. */
    private static final int HEX_LENGTH = 16;

    public static final int MAX_PER_LISTING = 20;

    private static final int SAMPLE_EDGE = 256;

    private static final Pattern KEYED_URL =
            Pattern.compile("/photos/[^/?#]+/[0-9a-f-]{36}-([0-9a-f]{16})$");

    private PhotoHash() { }

    public static Long compute(byte[] image) {
        try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(image))) {
            if (in == null) {
                return null;
            }
            Iterator<ImageReader> readers = ImageIO.getImageReaders(in);
            if (!readers.hasNext()) {
                return null;
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(in, true, true);
                ImageReadParam param = reader.getDefaultReadParam();
                param.setSourceSubsampling(Math.max(1, reader.getWidth(0) / SAMPLE_EDGE),
                        Math.max(1, reader.getHeight(0) / SAMPLE_EDGE), 0, 0);
                return averageHash(reader.read(0, param));
            } finally {
                reader.dispose();
            }
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    static Long averageHash(BufferedImage img) {
        int w = img.getWidth();
        int h = img.getHeight();
        if (w < 8 || h < 8) {
            return null;
        }
        double[] sum = new double[64];
        int[] count = new int[64];
        for (int y = 0; y < h; y++) {
            int row = y * 8 / h * 8;
            for (int x = 0; x < w; x++) {
                int rgb = img.getRGB(x, y);
                int cell = row + x * 8 / w;
                sum[cell] += 0.299 * ((rgb >> 16) & 0xFF) + 0.587 * ((rgb >> 8) & 0xFF) + 0.114 * (rgb & 0xFF);
                count[cell]++;
            }
        }
        double mean = 0;
        for (int i = 0; i < 64; i++) {
            sum[i] /= count[i];
            mean += sum[i] / 64;
        }
        long hash = 0;
        for (int i = 0; i < 64; i++) {
            hash = (hash << 1) | (sum[i] >= mean ? 1 : 0);
        }
        return hash;
    }

    public static String toHex(long hash) {
        return String.format("%016x", hash);
    }

    public static List<String> fromGallery(List<String> urls) {
        if (urls == null) {
            return null;
        }
        return urls.stream().filter(Objects::nonNull).map(KEYED_URL::matcher)
                .filter(Matcher::find).map(m -> m.group(1)).toList();
    }

    /** Malformed hashes drop the duplicate signal, not the listing submission. */
    public static Long parse(String hex) {
        if (hex == null || hex.length() != HEX_LENGTH) {
            return null;
        }
        try {
            return Long.parseUnsignedLong(hex, 16);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public static int distance(long a, long b) {
        return Long.bitCount(a ^ b);
    }

    public static boolean sameShot(long a, long b) {
        return distance(a, b) <= THRESHOLD;
    }

    /** The four 16-bit bands, in the same order as the generated columns. */
    public static int[] bands(long hash) {
        return new int[] {
            (int) ((hash >> 48) & 0xFFFF),
            (int) ((hash >> 32) & 0xFFFF),
            (int) ((hash >> 16) & 0xFFFF),
            (int) (hash & 0xFFFF),
        };
    }
}
