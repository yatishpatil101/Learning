package com.draazy.api.identity.verification;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.FileStorage;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
class IdentityFilePurgeAfterCommitTest {

    @Autowired
    UserRepository users;
    @Autowired
    IdentityVerificationRepository verifications;
    @Autowired
    IdentityVerificationFileRepository files;
    @Autowired
    IdentityVerificationService service;
    @Autowired
    IdentityFilePurgeService purgeService;
    @Autowired
    IdentityStorageDeleteRepository deletes;
    @Autowired
    TransactionTemplate transactions;
    @Autowired
    CapturingStorage storage;

    @BeforeEach
    void clearState() {
        deletes.deleteAll();
        storage.clear();
    }

    @Test
    void fileDeleteRunsAfterCommit_notOnRollback() {
        User user = new User(String.format("98%08d", ThreadLocalRandom.current().nextInt(100_000_000)),
                Roles.Wire.BUYER);
        user.setMobileVerified(true);
        users.saveAndFlush(user);
        IdentityVerification verification = verifications.saveAndFlush(
                new IdentityVerification(user.getId(), IdentityDocTypes.PAN, Instant.now()));
        String key = "identity/test/rollback";
        files.saveAndFlush(new IdentityVerificationFile(verification.getId(),
                IdentityVerificationFile.FRONT, key, "image/png", 12));

        transactions.executeWithoutResult(status -> {
            service.erase(user.getId());
            status.setRollbackOnly();
        });

        assertThat(storage.deleted()).isEmpty();
        assertThat(deletes.findById(key)).isEmpty();
        assertThat(files.findByVerificationId(verification.getId())).hasSize(1);

        transactions.executeWithoutResult(status -> service.erase(user.getId()));

        assertThat(storage.deleted()).containsExactly(key);
        assertThat(deletes.findById(key)).isEmpty();
        assertThat(files.findByVerificationId(verification.getId())).isEmpty();
    }

    @Test
    void resubmissionPurgesOnlyOldKeys() {
        User user = user();

        service.submit(user.getId(), IdentityDocTypes.PAN, true, "en", claims("ABCDE1234F"),
                null, null, png("front"), null, png("selfie"));
        IdentityVerification verification = verifications.findByUserId(user.getId()).orElseThrow();
        List<String> oldKeys = files.findByVerificationId(verification.getId()).stream()
                .map(IdentityVerificationFile::getStorageKey)
                .toList();
        assertThat(storage.stored()).containsAll(oldKeys);

        transactions.executeWithoutResult(status -> {
            IdentityVerification v = verifications.findById(verification.getId()).orElseThrow();
            v.setStatus(VerificationStatuses.REJECTED);
            v.setRejectionReason("blurry");
            v.setDecidedAt(Instant.now());
        });

        service.submit(user.getId(), IdentityDocTypes.PAN, true, "en", claims("FGHIJ5678K"),
                null, null, png("front"), null, png("selfie"));
        List<String> newKeys = files.findByVerificationId(verification.getId()).stream()
                .map(IdentityVerificationFile::getStorageKey)
                .toList();

        assertThat(newKeys).doesNotContainAnyElementsOf(oldKeys);
        assertThat(storage.stored()).containsAll(newKeys).doesNotContainAnyElementsOf(oldKeys);
    }

    @Test
    void failedDeleteStaysQueuedForRetry() {
        User user = user();
        IdentityVerification verification = verifications.saveAndFlush(
                new IdentityVerification(user.getId(), IdentityDocTypes.PAN, Instant.now()));
        String key = "identity/test/retry";
        storage.store(key, new byte[] {1}, "image/png");
        files.saveAndFlush(new IdentityVerificationFile(verification.getId(),
                IdentityVerificationFile.FRONT, key, "image/png", 1));

        storage.failDeletes(true);
        transactions.executeWithoutResult(status -> service.erase(user.getId()));

        IdentityStorageDelete queued = deletes.findById(key).orElseThrow();
        assertThat(queued.getAttempts()).isEqualTo(1);
        assertThat(storage.stored()).contains(key);

        storage.failDeletes(false);
        purgeService.retryQueuedDeletes(Instant.now().plusSeconds(600), 10);

        assertThat(deletes.findById(key)).isEmpty();
        assertThat(storage.stored()).doesNotContain(key);
    }

    @Test
    void submittedFilesAreDeletedWhenSubmitTransactionRollsBack() {
        User user = user();

        transactions.executeWithoutResult(status -> {
            service.submit(user.getId(), IdentityDocTypes.PAN, true, "en", claims("ABCDE1234F"),
                    null, null, png("front"), null, png("selfie"));
            assertThat(storage.stored()).hasSize(2);
            status.setRollbackOnly();
        });

        assertThat(storage.stored()).isEmpty();
        assertThat(deletes.findAll()).isEmpty();
    }

    @Test
    void rollbackDeleteFailureIsQueuedForRetry() {
        User user = user();
        storage.failDeletes(true);

        transactions.executeWithoutResult(status -> {
            service.submit(user.getId(), IdentityDocTypes.PAN, true, "en", claims("ABCDE1234F"),
                    null, null, png("front"), null, png("selfie"));
            status.setRollbackOnly();
        });

        assertThat(storage.stored()).hasSize(2);
        assertThat(deletes.findAll()).hasSize(2).allSatisfy(row -> assertThat(row.getAttempts()).isEqualTo(1));
        storage.failDeletes(false);
        purgeService.retryQueuedDeletes(Instant.now().plusSeconds(600), 10);

        assertThat(storage.stored()).isEmpty();
        assertThat(deletes.findAll()).isEmpty();
    }

    private User user() {
        User user = new User(String.format("98%08d", ThreadLocalRandom.current().nextInt(100_000_000)),
                Roles.Wire.BUYER);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private static MockMultipartFile png(String field) {
        byte[] pngMagic = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};
        return new MockMultipartFile(field, field + ".png", "image/png", pngMagic);
    }

    private static String claims(String number) {
        return "{\"number\":\"" + number + "\",\"name\":\"Asha Patil\",\"dob\":\"1991-04-12\"}";
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class StorageConfig {
        @Bean
        @Primary
        CapturingStorage capturingStorage() {
            return new CapturingStorage();
        }
    }

    static class CapturingStorage implements FileStorage {
        private final Set<String> stored = new HashSet<>();
        private final List<String> deleted = new ArrayList<>();
        private boolean failDeletes;

        void clear() {
            stored.clear();
            deleted.clear();
            failDeletes = false;
        }

        void failDeletes(boolean failDeletes) {
            this.failDeletes = failDeletes;
        }

        List<String> deleted() {
            return List.copyOf(deleted);
        }

        Set<String> stored() {
            return Set.copyOf(stored);
        }

        @Override
        public void store(String key, byte[] content, String contentType) {
            stored.add(key);
        }

        @Override
        public String signedUploadUrl(String key) {
            return key;
        }

        @Override
        public String signedDownloadUrl(String key) {
            return key;
        }

        @Override
        public void delete(String key) {
            if (failDeletes) {
                throw new IllegalStateException("storage unavailable");
            }
            stored.remove(key);
            deleted.add(key);
        }

        @Override
        public String storePublic(String key, byte[] content, String contentType) {
            return key;
        }

        @Override
        public String publicUrlPrefix() {
            return "";
        }
    }
}
