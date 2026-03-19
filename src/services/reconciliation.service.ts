import { logger } from '../utils/logger';
import * as squareService from './square.service';
import * as ghlService from './ghl.service';
import { findBySquareId, createMapping } from '../db';

export async function reconcile() {
  logger.info('Starting reconciliation...');

  try {
    const now = new Date();
    const startAtMin = new Date(now.getTime() - 24 * 60 * 60_000).toISOString(); // 1 day ago
    const startAtMax = new Date(now.getTime() + 90 * 24 * 60 * 60_000).toISOString(); // 90 days ahead

    const bookings = await squareService.listRecentBookings(startAtMin, startAtMax);

    let synced = 0;
    for (const booking of bookings) {
      if (!booking.id) continue;
      if (booking.status === 'CANCELLED_BY_CUSTOMER' || booking.status === 'CANCELLED_BY_SELLER') continue;

      const existing = findBySquareId(booking.id);
      if (existing) continue;

      // Unmapped booking — create block slot in GHL
      const startAt = booking.startAt;
      const segment = booking.appointmentSegments?.[0];
      const durationMinutes = segment ? Number(segment.durationMinutes || 60) : 60;
      const endAt = new Date(new Date(startAt!).getTime() + durationMinutes * 60_000).toISOString();

      const title = `[Square] ${booking.customerNote || 'Booking'}`;

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

        synced++;
      } catch (error) {
        logger.error('Reconciliation: failed to sync booking', { bookingId: booking.id, error });
      }
    }

    logger.info(`Reconciliation complete: ${synced} bookings synced, ${bookings.length} total checked`);
  } catch (error) {
    logger.error('Reconciliation failed', { error });
  }
}
