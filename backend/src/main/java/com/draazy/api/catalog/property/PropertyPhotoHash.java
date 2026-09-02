package com.draazy.api.catalog.property;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * One perceptual hash of one photo on one listing.
 *
 * <p>A row rather than an entry in a JSON array on {@link Property} because this is the one photo
 * fact that is queried <em>by value</em>: the duplicate probe asks "who else has a photo like this",
 * which an array column cannot answer without reading every listing. The neighbouring
 * {@code images} and {@code amenities} arrays are only ever read back whole, which is why they are
 * still arrays.
 *
 * <p>Not a JPA association from {@code Property}. The probe reads these across owners and the write
 * path replaces them wholesale, and neither wants a collection initialised on every listing load —
 * a listing's photo hashes are of no interest to any of the dozens of reads that render one.
 *
 * <p>The band columns are mapped read-only. Postgres generates them from {@link #hash} (V116) so
 * that the definition of a band lives in exactly one place; mapping them as writable would let a
 * future {@code save} contradict the column definition, and mapping them not at all would push the
 * probe's query into native SQL for no gain.
 */
@Entity
@Table(name = "property_photo_hashes")
@IdClass(PropertyPhotoHash.Key.class)
@Getter
@NoArgsConstructor
public class PropertyPhotoHash {

    @Id
    @Column(name = "property_id", nullable = false)
    private UUID propertyId;

    /**
     * The 64 bits, as a signed long.
     *
     * <p>Half of all hashes have the top bit set and therefore store negative. That is not a bug to
     * correct on the way in or out: every operation performed on this value — XOR, popcount, band
     * masking, equality — is bitwise, and two's complement makes all four sign-blind. Rendering it
     * as a number anywhere user-facing would be the bug, and nothing does.
     */
    @Column(name = "hash", nullable = false)
    private long hash;

    @Column(name = "band0", insertable = false, updatable = false)
    private int band0;

    @Column(name = "band1", insertable = false, updatable = false)
    private int band1;

    @Column(name = "band2", insertable = false, updatable = false)
    private int band2;

    @Column(name = "band3", insertable = false, updatable = false)
    private int band3;

    public PropertyPhotoHash(UUID propertyId, long hash) {
        this.propertyId = propertyId;
        this.hash = hash;
    }

    /** The composite key. Public because {@code @IdClass} is instantiated by the provider. */
    @NoArgsConstructor
    @Getter
    public static class Key implements Serializable {
        private UUID propertyId;
        private long hash;

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            if (!(o instanceof Key other)) {
                return false;
            }
            return hash == other.hash && Objects.equals(propertyId, other.propertyId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(propertyId, hash);
        }
    }
}
