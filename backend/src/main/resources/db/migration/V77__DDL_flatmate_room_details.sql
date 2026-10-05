-- Floor, bathrooms, furniture and the address lines below the society: the wizard asked for them
-- but nothing stored them, so editing a room showed the host a blank form. One jsonb object because
-- only the host's own edit form reads them back; FlatmateRoomDetails validates its shape.
ALTER TABLE flatmate_rooms
    ADD COLUMN details jsonb CHECK (details IS NULL OR jsonb_typeof(details) = 'object');

COMMENT ON COLUMN flatmate_rooms.details IS
    'Host-only wizard answers (floor, totalFloors, floorsInHouse, bathrooms, balconies, furniture, '
    'tower, street, landmark, pincode). Returned only on the host''s own read of the room.';
