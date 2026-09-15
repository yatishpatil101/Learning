package com.draazy.api.identity.verification;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface IdentityVerificationFileRepository extends JpaRepository<IdentityVerificationFile, UUID> {

    List<IdentityVerificationFile> findByVerificationId(UUID verificationId);

    void deleteByVerificationId(UUID verificationId);
}
