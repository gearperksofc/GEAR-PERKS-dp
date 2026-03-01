-- Create duel_rooms table for VS JOGADOR multiplayer mode
CREATE TABLE IF NOT EXISTS duel_rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_code VARCHAR(6) NOT NULL UNIQUE,
  host_id UUID NOT NULL,
  host_name TEXT NOT NULL DEFAULT 'Jogador',
  host_avatar TEXT,
  host_deck JSONB,
  host_ready BOOLEAN NOT NULL DEFAULT FALSE,
  guest_id UUID,
  guest_name TEXT,
  guest_avatar TEXT,
  guest_deck JSONB,
  guest_ready BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'lobby', 'playing', 'finished')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookup by room_code
CREATE INDEX IF NOT EXISTS duel_rooms_room_code_idx ON duel_rooms (room_code);

-- Index for cleanup of old rooms
CREATE INDEX IF NOT EXISTS duel_rooms_created_at_idx ON duel_rooms (created_at);

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_duel_rooms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS duel_rooms_updated_at ON duel_rooms;
CREATE TRIGGER duel_rooms_updated_at
  BEFORE UPDATE ON duel_rooms
  FOR EACH ROW EXECUTE FUNCTION update_duel_rooms_updated_at();

-- Enable Row Level Security
ALTER TABLE duel_rooms ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read rooms (needed to find room by code)
CREATE POLICY IF NOT EXISTS "duel_rooms_read_all" ON duel_rooms
  FOR SELECT USING (true);

-- Allow anyone to insert (create room)
CREATE POLICY IF NOT EXISTS "duel_rooms_insert_all" ON duel_rooms
  FOR INSERT WITH CHECK (true);

-- Allow host or guest to update their room
CREATE POLICY IF NOT EXISTS "duel_rooms_update_all" ON duel_rooms
  FOR UPDATE USING (true);

-- Allow host or guest to delete their room
CREATE POLICY IF NOT EXISTS "duel_rooms_delete_all" ON duel_rooms
  FOR DELETE USING (true);

-- Enable Realtime for this table so subscriptions work
ALTER PUBLICATION supabase_realtime ADD TABLE duel_rooms;
