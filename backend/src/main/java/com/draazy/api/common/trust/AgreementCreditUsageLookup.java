package com.draazy.api.common.trust;

import java.util.UUID;

/** Counted by {@code services} so {@code billing} can report it without importing a feature. */
public interface AgreementCreditUsageLookup {

    long agreementCreditsHeld(UUID userId);
}
