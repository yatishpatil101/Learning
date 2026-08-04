package com.punenest.api.identity.kyc;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OwnerKycRepository extends JpaRepository<OwnerKyc, UUID> {
}
