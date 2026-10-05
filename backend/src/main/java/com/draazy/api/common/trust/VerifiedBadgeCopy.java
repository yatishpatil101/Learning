package com.draazy.api.common.trust;

import java.util.UUID;

public interface VerifiedBadgeCopy {

    void copyBadge(UUID userId, boolean verified);
}
