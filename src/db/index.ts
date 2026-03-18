import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

const DB_PATH = path.join(process.cwd(), 'sync-mappings.json');

export interface BookingMapping {
  id?: number;
  square_booking_id: string | null;
  ghl_event_id: string | null;
  source: 'square' | 'ghl';
  status: string;
  square_service_variation_id?: string | null;
  square_team_member_id?: string | null;
  created_at?: string;
}

let mappings: BookingMapping[] = [];
let nextId = 1;

// Load from disk if exists
try {
  if (fs.existsSync(DB_PATH)) {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    mappings = data.mappings || [];
    nextId = data.nextId || 1;
  }
} catch {
  mappings = [];
  nextId = 1;
}

function save(): void {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify({ mappings, nextId }, null, 2));
  } catch (err) {
    logger.warn('Failed to persist mappings to disk', { err });
  }
}

export function createMapping(mapping: Omit<BookingMapping, 'id'>): void {
  const entry: BookingMapping = {
    ...mapping,
    id: nextId++,
    created_at: new Date().toISOString(),
  };
  mappings.push(entry);
  save();
  logger.info('Mapping created', mapping);
}

export function findBySquareId(squareBookingId: string): BookingMapping | undefined {
  return mappings.find(m => m.square_booking_id === squareBookingId && m.status === 'active');
}

export function findByGhlId(ghlEventId: string): BookingMapping | undefined {
  return mappings.find(m => m.ghl_event_id === ghlEventId && m.status === 'active');
}

export function deactivateBySquareId(squareBookingId: string): void {
  for (const m of mappings) {
    if (m.square_booking_id === squareBookingId) m.status = 'cancelled';
  }
  save();
}

export function deactivateByGhlId(ghlEventId: string): void {
  for (const m of mappings) {
    if (m.ghl_event_id === ghlEventId) m.status = 'cancelled';
  }
  save();
}

export function getActiveSquareIds(): string[] {
  return mappings
    .filter(m => m.source === 'square' && m.status === 'active' && m.square_booking_id)
    .map(m => m.square_booking_id!);
}
