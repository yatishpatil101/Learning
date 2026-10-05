package com.draazy.api.catalog.photo;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReadParam;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.ImageOutputStream;

/**
 * Card-sized JPEG copies of a listing photo, so a results page never downloads the full original.
 * Made server-side so the picture on a card is always the picture the gallery and moderators see.
 */
final class PhotoVariants {

    // Must match cardSrcSet in frontend/src/lib/imgSrcSet.js. Widest first: each is scaled from the last.
    static final int[] WIDTHS = {960, 480};

    private static final float QUALITY = 0.8f;
    private static final double DECODE_PIXEL_BUDGET = 8_000_000;

    private PhotoVariants() {
    }

    static String key(String originalKey, int width) {
        return originalKey + ".w" + width + ".jpg";
    }

    /** Never wider than the original; empty when the bytes cannot be decoded. */
    static Map<Integer, byte[]> of(byte[] photo) throws IOException {
        BufferedImage image = decode(photo, WIDTHS[0]);
        Map<Integer, byte[]> variants = new LinkedHashMap<>();
        if (image == null) {
            return variants;
        }
        for (int width : WIDTHS) {
            image = scale(image, Math.min(width, image.getWidth()));
            variants.put(width, encode(image));
        }
        return variants;
    }

    // Subsampled at decode so a 40 MP upload never becomes a bitmap of hundreds of MB, whatever its
    // aspect ratio; at least twice the widest variant across when the budget allows, so the
    // averaging in `scale` still has real pixels to work with.
    private static BufferedImage decode(byte[] photo, int widest) throws IOException {
        try (ImageInputStream in = ImageIO.createImageInputStream(new ByteArrayInputStream(photo))) {
            Iterator<ImageReader> readers = in == null ? null : ImageIO.getImageReaders(in);
            if (readers == null || !readers.hasNext()) {
                return null;
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(in, true, true);
                long width = reader.getWidth(0);
                long height = reader.getHeight(0);
                int step = (int) Math.max(Math.max(1, width / (2L * widest)),
                        Math.ceil(Math.sqrt((double) width * height / DECODE_PIXEL_BUDGET)));
                ImageReadParam param = reader.getDefaultReadParam();
                param.setSourceSubsampling(step, step, 0, 0);
                return reader.read(0, param);
            } finally {
                reader.dispose();
            }
        }
    }

    // Halving first: a single bilinear step over a large ratio skips pixels and shimmers.
    private static BufferedImage scale(BufferedImage source, int width) {
        BufferedImage current = source;
        while (current.getWidth() / 2 > width) {
            current = resize(current, current.getWidth() / 2);
        }
        return resize(current, width);
    }

    // Opaque RGB on white, as the browser's upload encoder does, since JPEG has no alpha.
    private static BufferedImage resize(BufferedImage source, int width) {
        int height = Math.max(1, Math.round((float) source.getHeight() * width / source.getWidth()));
        BufferedImage out = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setColor(Color.WHITE);
            g.fillRect(0, 0, width, height);
            g.drawImage(source, 0, 0, width, height, null);
        } finally {
            g.dispose();
        }
        return out;
    }

    private static byte[] encode(BufferedImage image) throws IOException {
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        ImageWriteParam param = writer.getDefaultWriteParam();
        param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
        param.setCompressionQuality(QUALITY);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ImageOutputStream stream = ImageIO.createImageOutputStream(out)) {
            writer.setOutput(stream);
            writer.write(null, new IIOImage(image, null, null), param);
        } finally {
            writer.dispose();
        }
        return out.toByteArray();
    }
}
