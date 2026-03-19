import { Router } from 'express';
import { handleSquareWebhook } from '../handlers/square-webhook.handler';
import { handleGhlCreated, handleGhlCancelled, handleGhlUpdated } from '../handlers/ghl-to-square.handler';

const router = Router();

// Square sends webhooks here
router.post('/webhooks/square', handleSquareWebhook);

// GHL workflows send Custom Webhooks here
router.post('/ghl-to-square', handleGhlCreated);
router.post('/ghl-cancelled', handleGhlCancelled);
router.post('/ghl-updated', handleGhlUpdated);

// Health check
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// === TEMPORARY: One-time backfill of all existing Square bookings to GHL ===
router.post('/backfill', async (_req, res) => {
  try {
    const squareService = await import('../services/square.service');
    const ghlService = await import('../services/ghl.service');
    const db = await import('../db');
    const { logger } = await import('../utils/logger');

    const now = new Date();
    // Backfill: from today forward up to 90 days
    const startAtMin = now.toISOString();
    const startAtMax = new Date(now.getTime() + 90 * 24 * 60 * 60_000).toISOString();

    const bookings = await squareService.listRecentBookings(startAtMin, startAtMax);

    let synced = 0;
    let skipped = 0;
    let cancelled = 0;
    const errors: string[] = [];

    for (const booking of bookings) {
      if (!booking.id) continue;
      if (booking.status === 'CANCELLED_BY_CUSTOMER' || booking.status === 'CANCELLED_BY_SELLER' || booking.status === 'DECLINED') {
        cancelled++;
        continue;
      }

      const existing = db.findBySquareId(booking.id);
      if (existing) {
        skipped++;
        continue;
      }

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

        db.createMapping({
          square_booking_id: booking.id,
          ghl_event_id: ghlEvent.id || ghlEvent.event?.id,
          source: 'square',
          status: 'active',
          square_service_variation_id: segment?.serviceVariationId,
          square_team_member_id: segment?.teamMemberId,
        });

        synced++;
        logger.info('Backfill: synced booking', { bookingId: booking.id, startAt });
      } catch (err: any) {
        errors.push(`${booking.id}: ${err?.message || String(err)}`);
      }
    }

    res.json({
      ok: true,
      totalBookings: bookings.length,
      synced,
      skipped,
      cancelled,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
});

export default router;
