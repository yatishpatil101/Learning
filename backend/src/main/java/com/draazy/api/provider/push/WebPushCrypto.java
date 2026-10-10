package com.draazy.api.provider.push;

import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPrivateKeySpec;
import java.security.spec.ECPublicKeySpec;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** RFC 8291 (aes128gcm message encryption) and RFC 8292 (VAPID) on the JDK alone. */
final class WebPushCrypto {

    private static final int RECORD_SIZE = 4096;
    private static final int POINT_LENGTH = 65;
    private static final byte[] KEY_INFO_PREFIX = "WebPush: info\0".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] CEK_INFO = "Content-Encoding: aes128gcm\0".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] NONCE_INFO = "Content-Encoding: nonce\0".getBytes(StandardCharsets.US_ASCII);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final ECParameterSpec P256 = p256();

    private WebPushCrypto() {
    }

    static byte[] decode(String base64url) {
        return Base64.getUrlDecoder().decode(base64url.strip().replace("=", ""));
    }

    static String encode(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static KeyPair newKeyPair() throws GeneralSecurityException {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        return generator.generateKeyPair();
    }

    static PrivateKey privateKey(String base64url) throws GeneralSecurityException {
        return KeyFactory.getInstance("EC")
                .generatePrivate(new ECPrivateKeySpec(new BigInteger(1, decode(base64url)), P256));
    }

    static PublicKey publicKey(byte[] point) throws GeneralSecurityException {
        if (point.length != POINT_LENGTH || point[0] != 4) {
            throw new IllegalArgumentException("not an uncompressed P-256 point");
        }
        ECPoint w = new ECPoint(new BigInteger(1, Arrays.copyOfRange(point, 1, 33)),
                new BigInteger(1, Arrays.copyOfRange(point, 33, POINT_LENGTH)));
        return KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(w, P256));
    }

    static byte[] uncompressed(PublicKey key) {
        ECPoint w = ((ECPublicKey) key).getW();
        byte[] out = new byte[POINT_LENGTH];
        out[0] = 4;
        copyFixed(w.getAffineX(), out, 1);
        copyFixed(w.getAffineY(), out, 33);
        return out;
    }

    static byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret)
            throws GeneralSecurityException {
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        return encrypt(plaintext, uaPublic, authSecret, newKeyPair(), salt);
    }

    static byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret, KeyPair applicationServer,
            byte[] salt) throws GeneralSecurityException {
        byte[] asPublic = uncompressed(applicationServer.getPublic());
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(applicationServer.getPrivate());
        agreement.doPhase(publicKey(uaPublic), true);
        byte[] ecdhSecret = agreement.generateSecret();

        byte[] prkKey = hmac(authSecret, ecdhSecret);
        byte[] keyInfo = concat(KEY_INFO_PREFIX, uaPublic, asPublic);
        byte[] ikm = hmac(prkKey, concat(keyInfo, new byte[] {1}));
        byte[] prk = hmac(salt, ikm);
        byte[] cek = Arrays.copyOf(hmac(prk, concat(CEK_INFO, new byte[] {1})), 16);
        byte[] nonce = Arrays.copyOf(hmac(prk, concat(NONCE_INFO, new byte[] {1})), 12);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
        byte[] ciphertext = cipher.doFinal(concat(plaintext, new byte[] {2}));

        byte[] header = ByteBuffer.allocate(21 + asPublic.length)
                .put(salt).putInt(RECORD_SIZE).put((byte) asPublic.length).put(asPublic).array();
        return concat(header, ciphertext);
    }

    static String vapidJwt(PrivateKey key, String audience, String subject, long expiresAtEpochSeconds)
            throws GeneralSecurityException {
        String signingInput = encode("{\"typ\":\"JWT\",\"alg\":\"ES256\"}".getBytes(StandardCharsets.UTF_8))
                + "." + encode(("{\"aud\":\"" + audience + "\",\"exp\":" + expiresAtEpochSeconds
                        + ",\"sub\":\"" + subject + "\"}").getBytes(StandardCharsets.UTF_8));
        Signature signature = Signature.getInstance("SHA256withECDSAinP1363Format");
        signature.initSign(key);
        signature.update(signingInput.getBytes(StandardCharsets.US_ASCII));
        return signingInput + "." + encode(signature.sign());
    }

    static boolean isPair(PrivateKey privateKey, PublicKey publicKey) throws GeneralSecurityException {
        byte[] probe = "vapid".getBytes(StandardCharsets.US_ASCII);
        Signature signer = Signature.getInstance("SHA256withECDSAinP1363Format");
        signer.initSign(privateKey);
        signer.update(probe);
        byte[] signature = signer.sign();
        Signature verifier = Signature.getInstance("SHA256withECDSAinP1363Format");
        verifier.initVerify(publicKey);
        verifier.update(probe);
        return verifier.verify(signature);
    }

    private static byte[] hmac(byte[] key, byte[] data) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(data);
    }

    private static byte[] concat(byte[]... parts) {
        int length = 0;
        for (byte[] part : parts) {
            length += part.length;
        }
        byte[] out = new byte[length];
        int offset = 0;
        for (byte[] part : parts) {
            System.arraycopy(part, 0, out, offset, part.length);
            offset += part.length;
        }
        return out;
    }

    private static void copyFixed(BigInteger value, byte[] out, int offset) {
        byte[] raw = value.toByteArray();
        int skip = raw.length > 32 ? raw.length - 32 : 0;
        int length = raw.length - skip;
        System.arraycopy(raw, skip, out, offset + 32 - length, length);
    }

    private static ECParameterSpec p256() {
        try {
            AlgorithmParameters parameters = AlgorithmParameters.getInstance("EC");
            parameters.init(new ECGenParameterSpec("secp256r1"));
            return parameters.getParameterSpec(ECParameterSpec.class);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("secp256r1 unavailable", e);
        }
    }
}
