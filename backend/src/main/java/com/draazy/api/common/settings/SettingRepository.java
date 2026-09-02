package com.draazy.api.common.settings;

import org.springframework.data.jpa.repository.JpaRepository;

/** Reads {@link Setting} rows. Writes belong to the admin settings surface, which is not built yet. */
public interface SettingRepository extends JpaRepository<Setting, String> {
}
