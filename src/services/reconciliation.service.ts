import { Booking } from 'square';
import { logger } from '../utils/logger';
import * as squareService from './square.service';
import * as ghlService from './ghl.service';
import { findBySquareId, createMapping } from '../db';

const CHUNK_DAYS = 30; // Square API max is 31 days per request
const TOTAL_DAYS = 90;

export async function reconcile() {
  logger.info('Starting reconciliation...');

  try {
    const now = new Date();

    // 1. Get existing GHL block slots to check for duplicates by title
    //    Title format: [Square:bookingId] note
    let existingTitles: Set<string>;
    try {
      const existingSlots = await ghlService.listBlockedSlots(
        now.getTime() - 7 * 24 * 60 * 60_000,
        now.getTime() + 120 * 24 * 60 * 60_000,
      );
      existingTitles = new Set(existingSlots.map((s: any) => s.title));
    } catch {
      existingTitles = new Set();
    }

    // 2. Fetch bookings in 30-day chunks (Square API limits to 31 days)
    const allBookings: Booking[] = [];
    const startOffset = -1; // 1 day ago
    for (let offset = startOffset; offset < TOTAL_DAYS; offset += CHUNK_DAYS) {
      const chunkStart = new Date(now.getTime() + offset * 24 * 60 * 60_000);
      const chunkEnd = new Date(now.getTime() + Math.min(offset + CHUNK_DAYS, TOTAL_DAYS) * 24 * 60 * 60_000);
      try {
        const chunk = await squareService.listRecentBookings(chunkStart.toISOString(), chunkEnd.toISOString());
        allBookings.push(...chunk);
      } catch (error) {
        logger.warn('Reconciliation: chunk failed', { offset, error });
      }
    }

    let synced = 0;
    for (const booking of allBookings) {
      if (!booking.id) continue;
      if (booking.status === 'CANCELLED_BY_CUSTOMER' || booking.status === 'CANCELLED_BY_SELLER') continue;

      // Skip if already mapped in local DB
      if (findBySquareId(booking.id)) continue;

      // Skip if block slot already exists in GHL (dedup by title with booking ID)
      const title = `[Square:${booking.id}] ${booking.customerNote || 'Booking'}`;
      if (existingTitles.has(title)) continue;

      const startAt = booking.startAt;
      const segment = booking.appointmentSegments?.[0];
      const durationMinutes = segment ? Number(segment.durationMinutes || 60) : 60;
      const endAt = new Date(new Date(startAt!).getTime() + durationMinutes * 60_000).toISOString();

      try {
        const ghlEvent = await ghlService.createBlockSlot({
          title,
          startTime: startAt!,
          endTime: endAt,
        });

        createMapping({
          square_booking_id: booking.id,
          ghl_event_id: ghlEvent.id || ghlEvent.event?.id,
          source: 'square',
          status: 'active',
          square_service_variation_id: segment?.serviceVariationId,
          square_team_member_id: segment?.teamMemberId,
        });

        existingTitles.add(title);
        synced++;
      } catch (error) {
        logger.error('Reconciliation: failed to sync booking', { bookingId: booking.id, error });
      }
    }

    logger.info(`Reconciliation complete: ${synced} bookings synced, ${allBookings.length} total checked`);
  } catch (error) {
    logger.error('Reconciliation failed', { error });
  }
}
