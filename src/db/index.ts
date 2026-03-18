import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../utils/logger';

const DB_PATH = path.join(process.cwd(), 'sync-mappings.db');

const db: InstanceType<typeof Database> = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS booking_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    square_booking_id TEXT,
    ghl_event_id TEXT,
    source TEXT NOT NULL CHECK(source IN ('square', 'ghl')),
    status TEXT NOT NULL DEFAULT 'active',
    square_service_variation_id TEXT,
    square_team_member_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_square_booking ON booking_mappings(square_booking_id);
  CREATE INDEX IF NOT EXISTS idx_ghl_event ON booking_mappings(ghl_event_id);
`);

export interface BookingMapping {
  id?: number;
  square_booking_id: string | null;
  ghl_event_id: string | null;
  source: 'square' | 'ghl';
  status: string;
  square_service_variation_id?: string | null;
  square_team_member_id?: string | null;
}

export function createMapping(mapping: Omit<BookingMapping, 'id'>): void {
  const stmt = db.prepare(`
    INSERT INTO booking_mappings (square_booking_id, ghl_event_id, source, status, square_service_variation_id, square_team_member_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    mapping.square_booking_id,
    mapping.ghl_event_id,
    mapping.source,
    mapping.status,
    mapping.square_service_variation_id ?? null,
    mapping.square_team_member_id ?? null
  );
  logger.info('Mapping created', mapping);
}

export function findBySquareId(squareBookingId: string): BookingMapping | undefined {
  return db.prepare('SELECT * FROM booking_mappings WHERE square_booking_id = ? AND status = ?')
    .get(squareBookingId, 'active') as BookingMapping | undefined;
}

export function findByGhlId(ghlEventId: string): BookingMapping | undefined {
  return db.prepare('SELECT * FROM booking_mappings WHERE ghl_event_id = ? AND status = ?')
    .get(ghlEventId, 'active') as BookingMapping | undefined;
}

export function deactivateBySquareId(squareBookingId: string): void {
  db.prepare("UPDATE booking_mappings SET status = 'cancelled', updated_at = datetime('now') WHERE square_booking_id = ?")
    .run(squareBookingId);
}

export function deactivateByGhlId(ghlEventId: string): void {
  db.prepare("UPDATE booking_mappings SET status = 'cancelled', updated_at = datetime('now') WHERE ghl_event_id = ?")
    .run(ghlEventId);
}

export function getActiveSquareIds(): string[] {
  const rows = db.prepare("SELECT square_booking_id FROM booking_mappings WHERE source = 'square' AND status = 'active'").all() as { square_booking_id: string }[];
  return rows.map(r => r.square_booking_id);
}

export default db;
