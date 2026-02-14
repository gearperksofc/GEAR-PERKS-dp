-- Add avatar columns to duel_rooms for live profile picture display
ALTER TABLE duel_rooms ADD COLUMN IF NOT EXISTS host_avatar TEXT;
ALTER TABLE duel_rooms ADD COLUMN IF NOT EXISTS guest_avatar TEXT;
