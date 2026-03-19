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

// === TEMPORARY: Delete all [Square] block slots from GHL ===
router.delete('/cleanup-ghl', async (_req, res) => {
  try {
    const ghlService = await import('../services/ghl.service');
    const now = Date.now();
    const slots = await ghlService.listBlockedSlots(
      now - 30 * 24 * 60 * 60 * 1000,
      now + 120 * 24 * 60 * 60 * 1000,
    );

    const squareSlots = slots.filter((s: any) => s.title?.startsWith('[Square'));
    let deleted = 0;
    const errors: string[] = [];

    for (const slot of squareSlots) {
      try {
        await ghlService.deleteEvent(slot.id);
        deleted++;
      } catch (err: any) {
        errors.push(`${slot.id}: ${err?.message || String(err)}`);
      }
    }

    res.json({ ok: true, totalSlots: slots.length, squareSlots: squareSlots.length, deleted, errors: errors.length > 0 ? errors : undefined });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
});

// === TEMPORARY: Backfill with dedup (title-based, not file-based) ===
router.post('/backfill', async (_req, res) => {
  try {
    const squareService = await import('../services/square.service');
    const ghlService = await import('../services/ghl.service');
    const db = await import('../db');
    const { logger } = await import('../utils/logger');

    const now = new Date();
    const CHUNK_DAYS = 30;
    const TOTAL_DAYS = 90;

    // 1. Get all existing GHL block slots to check for duplicates by title
    const existingSlots = await ghlService.listBlockedSlots(
      now.getTime() - 7 * 24 * 60 * 60_000,
      now.getTime() + 120 * 24 * 60 * 60_000,
    );
    const existingTitles = new Set(existingSlots.map((s: any) => s.title));

    // 2. Collect all Square bookings
    const allBookings: any[] = [];
    for (let offset = 0; offset < TOTAL_DAYS; offset += CHUNK_DAYS) {
      const chunkStart = new Date(now.getTime() + offset * 24 * 60 * 60_000);
      const chunkEnd = new Date(now.getTime() + Math.min(offset + CHUNK_DAYS, TOTAL_DAYS) * 24 * 60 * 60_000);
      try {
        const chunk = await squareService.listRecentBookings(chunkStart.toISOString(), chunkEnd.toISOString());
        allBookings.push(...chunk);
      } catch (err: any) {
        logger.warn('Backfill: chunk failed', { offset, message: err?.message });
      }
    }

    let synced = 0;
    let skipped = 0;
    let cancelled = 0;
    const errors: string[] = [];

    for (const booking of allBookings) {
      if (!booking.id) continue;
      if (booking.status === 'CANCELLED_BY_CUSTOMER' || booking.status === 'CANCELLED_BY_SELLER' || booking.status === 'DECLINED') {
        cancelled++;
        continue;
      }

      // Dedup by title (includes booking ID)
      const title = `[Square:${booking.id}] ${booking.customerNote || 'Booking'}`;
      if (existingTitles.has(title)) {
        skipped++;
        continue;
      }

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

        db.createMapping({
          square_booking_id: booking.id,
          ghl_event_id: ghlEvent.id || ghlEvent.event?.id,
          source: 'square',
          status: 'active',
          square_service_variation_id: segment?.serviceVariationId,
          square_team_member_id: segment?.teamMemberId,
        });

        existingTitles.add(title);
        synced++;
        logger.info('Backfill: synced booking', { bookingId: booking.id, startAt });
      } catch (err: any) {
        errors.push(`${booking.id}: ${err?.message || String(err)}`);
      }
    }

    res.json({ ok: true, totalBookings: allBookings.length, synced, skipped, cancelled, errors: errors.length > 0 ? errors : undefined });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
});

// === TEMPORARY: Check GHL block slots status ===
router.get('/check-ghl', async (_req, res) => {
  try {
    const ghlService = await import('../services/ghl.service');
    const now = Date.now();
    const slots = await ghlService.listBlockedSlots(
      now - 7 * 24 * 60 * 60 * 1000,
      now + 120 * 24 * 60 * 60 * 1000,
    );
    const byDate: Record<string, number> = {};
    for (const slot of slots) {
      const date = new Date(slot.startTime || slot.start_time || slot.startDate).toISOString().split('T')[0];
      byDate[date] = (byDate[date] || 0) + 1;
    }
    res.json({ ok: true, totalSlots: slots.length, byDate });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
});

export default router;
