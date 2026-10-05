package com.draazy.api.common.trust;

import java.util.UUID;

public interface OwnerBadgeSink {

    int markOwnerVerified(UUID ownerId);

    int markOwnerUnverified(UUID ownerId);
}
