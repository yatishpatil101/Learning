package com.draazy.api.identity.verification;

import com.draazy.api.provider.FileStorage;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class IdentityFilePurgeService {

    private static final Logger log = LoggerFactory.getLogger(IdentityFilePurgeService.class);

    private final IdentityVerificationFileRepository files;
    private final IdentityStorageDeleteRepository deletes;
    private final FileStorage storage;
    private final TransactionTemplate transactions;

    public IdentityFilePurgeService(IdentityVerificationFileRepository files,
            IdentityStorageDeleteRepository deletes, FileStorage storage,
            PlatformTransactionManager transactionManager) {
        this.files = files;
        this.deletes = deletes;
        this.storage = storage;
        this.transactions = new TransactionTemplate(transactionManager);
        this.transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    void purgeFiles(IdentityVerification v) {
        List<String> keys = files.findByVerificationId(v.getId()).stream()
                .map(IdentityVerificationFile::getStorageKey)
                .toList();
        files.deleteByVerificationId(v.getId());
        files.flush();
        purgeKeys(keys);
    }

    public void purgeKeys(List<String> keys) {
        Instant queuedAt = Instant.now();
        keys.forEach(key -> deletes.queue(key, queuedAt));
        afterCommit(() -> keys.forEach(this::deleteStoredFile));
    }

    public int retryQueuedDeletes(Instant now, int batchSize) {
        List<IdentityStorageDelete> due = deletes.findDue(now, PageRequest.of(0, batchSize));
        due.forEach(row -> deleteStoredFile(row.getStorageKey()));
        return due.size();
    }

    void deleteIfRolledBack(String key) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                if (status == STATUS_ROLLED_BACK) {
                    deleteStoredFile(key, true);
                }
            }
        });
    }

    private void afterCommit(Runnable action) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            action.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    }

    private void deleteStoredFile(String key) {
        deleteStoredFile(key, false);
    }

    private void deleteStoredFile(String key, boolean queueMissing) {
        try {
            storage.delete(key);
            transactions.executeWithoutResult(status -> deletes.deleteById(key));
        } catch (RuntimeException e) {
            log.warn("Failed to delete identity verification file {}", key, e);
            transactions.executeWithoutResult(status -> {
                if (queueMissing) {
                    deletes.queue(key, Instant.now());
                }
                deletes.recordFailure(key, clipped(e));
            });
        }
    }

    private static String clipped(RuntimeException e) {
        String message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        return message.length() <= 500 ? message : message.substring(0, 500);
    }
}
