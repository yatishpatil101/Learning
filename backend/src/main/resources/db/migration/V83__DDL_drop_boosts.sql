-- Paid listing boosts are retired: no purchase route, no ranking input, no revenue line.
DROP TABLE boosts;
DROP TABLE boost_packs;
ALTER TABLE properties DROP COLUMN boosted_until;
UPDATE settings SET value = value - 'boostEnabled' WHERE key = 'flags';
