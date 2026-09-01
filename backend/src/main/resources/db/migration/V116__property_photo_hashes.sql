-- Perceptual photo hashes, so the image duplicate signal exists on the server.
--
-- Brokers re-list a flat by reusing the photos under a differently typed address, which is exactly
-- the case the meter (V115) and address arms miss. The client has hashed photos since the wizard was
-- written -- an 8x8 average hash, 64 bits, 16 hex chars -- but the hash never left the browser: it
-- was compared against `localStorage`, which in production holds only the listings that same browser
-- posted. The one set of photos it could ever match was the caller's own, which is the case the rule
-- explicitly refuses to flag. So the signal has never fired for anybody.
--
-- One row per (property, hash) rather than a JSON array on `properties`, because this table is
-- queried BY hash, and the array columns next to it (`images`, `amenities`) are only ever read back
-- whole. `on delete cascade`: a hash outliving its listing is a duplicate finding against a row no
-- moderator can open.
--
-- The hash is a bigint, not the 16-char hex string. Hamming distance is a popcount over an XOR, and
-- that is an integer operation; storing the text would mean parsing it back on every comparison.
-- Values above 2^63 land negative, which is fine -- two's complement XOR is bit-exact regardless of
-- how the sign is read.
--
-- The four band columns are the index strategy. Two hashes within Hamming distance d must share at
-- least one of four 16-bit bands when d <= 3 (pigeonhole: four bands, at most three differing bits,
-- so one band is untouched). The product's match threshold is 10, so band equality is a high-recall
-- pre-filter rather than a proof: everything it returns is Hamming-verified in Java, and a pair that
-- differs in all four bands is missed. That is a deliberate trade and it is only acceptable because
-- of what this signal does -- it FLAGS for the ops desk and never blocks an owner. Full recall at
-- d <= 10 is not indexable; it would mean reading every hash on the platform on every listing write.
--
-- Generated rather than written by the application so the bands cannot drift from the hash they
-- describe: there is one definition of "band 2 of this hash" and Postgres owns it. The mask discards
-- the sign extension an arithmetic right shift introduces, so the top band is the true top 16 bits.
CREATE TABLE property_photo_hashes (
    property_id uuid   NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
    hash        bigint NOT NULL,
    band0       int    GENERATED ALWAYS AS ((hash >> 48) & 65535) STORED,
    band1       int    GENERATED ALWAYS AS ((hash >> 32) & 65535) STORED,
    band2       int    GENERATED ALWAYS AS ((hash >> 16) & 65535) STORED,
    band3       int    GENERATED ALWAYS AS (hash & 65535) STORED,
    PRIMARY KEY (property_id, hash)
);

CREATE INDEX idx_pph_band0 ON property_photo_hashes (band0);
CREATE INDEX idx_pph_band1 ON property_photo_hashes (band1);
CREATE INDEX idx_pph_band2 ON property_photo_hashes (band2);
CREATE INDEX idx_pph_band3 ON property_photo_hashes (band3);
