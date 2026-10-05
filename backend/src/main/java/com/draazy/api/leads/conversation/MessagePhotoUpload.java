package com.draazy.api.leads.conversation;

import com.draazy.api.catalog.photo.PhotoUploads;
import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.validation.MediaSignatures;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.UncheckedIOException;
import java.util.Locale;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.springframework.web.multipart.MultipartFile;

final class MessagePhotoUpload {

    static final long MAX_BYTES = 8_000_000L;
    private static final int MAX_EDGE = 2048;
    private static final String SIZE_MESSAGE = "Chat photos can be up to 8 MB.";

    private MessagePhotoUpload() {
    }

    static Processed process(UUID conversationId, MultipartFile file) {
        if (file.getSize() > MAX_BYTES) {
            throw new PayloadTooLargeException(SIZE_MESSAGE);
        }
        byte[] bytes = readBytes(file);
        String type = PhotoUploads.validate(file.getContentType(), file.getSize(), bytes, MAX_BYTES, SIZE_MESSAGE);
        BufferedImage image = decode(bytes);
        BufferedImage resized = resize(image, type);
        byte[] out = encode(resized, type);
        PhotoUploads.validate(type, out.length, out, MAX_BYTES, SIZE_MESSAGE);
        String extension = MediaSignatures.PNG.equals(type) ? ".png" : ".jpg";
        return new Processed(out, type, safeName(file.getOriginalFilename(), extension),
                "messages/" + conversationId + "/" + UUID.randomUUID() + extension);
    }

    private static byte[] readBytes(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (java.io.IOException e) {
            throw new UncheckedIOException("cannot read uploaded chat photo", e);
        }
    }

    private static BufferedImage decode(byte[] bytes) {
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
            if (image == null) {
                throw new ValidationException("Upload a readable JPEG or PNG photo.");
            }
            return image;
        } catch (java.io.IOException e) {
            throw new ValidationException("Upload a readable JPEG or PNG photo.");
        }
    }

    private static BufferedImage resize(BufferedImage image, String type) {
        int longest = Math.max(image.getWidth(), image.getHeight());
        if (longest <= MAX_EDGE) {
            return image;
        }
        double scale = (double) MAX_EDGE / longest;
        int width = Math.max(1, (int) Math.round(image.getWidth() * scale));
        int height = Math.max(1, (int) Math.round(image.getHeight() * scale));
        BufferedImage out = new BufferedImage(width, height,
                MediaSignatures.PNG.equals(type) ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.drawImage(image, 0, 0, width, height, null);
        g.dispose();
        return out;
    }

    private static byte[] encode(BufferedImage image, String type) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (!ImageIO.write(image, MediaSignatures.PNG.equals(type) ? "png" : "jpg", out)) {
                throw new ValidationException("Upload a readable JPEG or PNG photo.");
            }
            return out.toByteArray();
        } catch (java.io.IOException e) {
            throw new ValidationException("Upload a readable JPEG or PNG photo.");
        }
    }

    private static String safeName(String original, String extension) {
        String name = original == null ? "" : original.replace('\\', '/');
        int slash = name.lastIndexOf('/');
        name = slash >= 0 ? name.substring(slash + 1) : name;
        name = name.replaceAll("[^A-Za-z0-9._ -]", "_").strip();
        if (name.isBlank()) {
            return "photo" + extension;
        }
        String lower = name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png")
                ? name : name + extension;
    }

    record Processed(byte[] bytes, String contentType, String fileName, String storageKey) {
    }
}
