-- Resource Booking Platform — Database Schema
-- Run this against a fresh PostgreSQL database (tested on Supabase Postgres 15+)

-- Required for the EXCLUDE constraint below (range + equality in one index)
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- 'user' | 'admin'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE resources (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  capacity INT,
  location TEXT,
  features TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  resource_id INT NOT NULL REFERENCES resources(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED', -- 'CONFIRMED' | 'CANCELLED'
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (end_time > start_time)
);

-- Speeds up the conflict-check query; only indexes bookings that can
-- actually block a new one (cancelled bookings never do).
CREATE INDEX idx_bookings_resource_time ON bookings (resource_id, start_time, end_time)
  WHERE status = 'CONFIRMED';

-- Database-level guarantee: makes an overlapping CONFIRMED booking for
-- the same resource impossible to insert, regardless of which code path
-- (or lack of one) attempts it. Backs up the application-level advisory
-- lock in src/controllers/bookingController.js.
ALTER TABLE bookings
ADD CONSTRAINT no_overlapping_bookings
EXCLUDE USING gist (
  resource_id WITH =,
  tstzrange(start_time, end_time) WITH &&
) WHERE (status = 'CONFIRMED');

-- Sample data
INSERT INTO resources (name, type, capacity, location, features) VALUES
('Room A', 'meeting_room', 6, 'Floor 2', ARRAY['projector', 'whiteboard']),
('Room B', 'meeting_room', 10, 'Floor 3', ARRAY['tv_screen']),
('Lab 1', 'computer_lab', 30, 'Floor 1', ARRAY['30_pcs', 'projector']);