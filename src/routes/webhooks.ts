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

// Diagnostic endpoint — test Square API connection (temporary)
router.get('/debug/test-square', async (_req, res) => {
  try {
    const { SquareEnvironment } = await import('square');
    const squareService = await import('../services/square.service');
    const bookings = await squareService.listRecentBookings(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    );
    res.json({
      ok: true,
      envValue: SquareEnvironment.Production,
      bookingsFound: bookings.length,
      bookings: bookings.map(b => ({ id: b.id, startAt: b.startAt, status: b.status })),
    });
  } catch (error: any) {
    const { SquareEnvironment } = require('square');
    res.status(500).json({
      ok: false,
      envValue: SquareEnvironment?.Production,
      message: error?.message || String(error),
      statusCode: error?.statusCode,
      body: error?.body,
      errors: error?.errors,
      name: error?.name,
      stack: error?.stack?.split('\n').slice(0, 5),
    });
  }
});

// Manual reconciliation trigger (temporary)
router.post('/debug/reconcile', async (_req, res) => {
  try {
    const { reconcile } = await import('../services/reconciliation.service');
    await reconcile();
    res.json({ ok: true, message: 'Reconciliation completed' });
  } catch (error: any) {
    res.status(500).json({ ok: false, message: error?.message || String(error) });
  }
});

// List GHL block slots (temporary — for cleanup)
router.get('/debug/ghl-block-slots', async (_req, res) => {
  try {
    const ghlService = await import('../services/ghl.service');
    const now = Date.now();
    const slots = await ghlService.listBlockedSlots(
      now - 30 * 24 * 60 * 60 * 1000, // 30 days ago
      now + 30 * 24 * 60 * 60 * 1000,  // 30 days ahead
    );
    res.json({ ok: true, count: slots.length, slots });
  } catch (error: any) {
    res.status(500).json({ ok: false, message: error?.message || String(error), data: error?.response?.data });
  }
});

// Delete a GHL event by ID (temporary — for cleanup)
router.delete('/debug/ghl-event/:eventId', async (req, res) => {
  try {
    const ghlService = await import('../services/ghl.service');
    await ghlService.deleteEvent(req.params.eventId);
    res.json({ ok: true, deleted: req.params.eventId });
  } catch (error: any) {
    res.status(500).json({ ok: false, message: error?.message || String(error), data: error?.response?.data });
  }
});

// Delete ALL GHL block slots in range (temporary — for cleanup)
router.delete('/debug/ghl-block-slots', async (_req, res) => {
  try {
    const ghlService = await import('../services/ghl.service');
    const now = Date.now();
    const slots = await ghlService.listBlockedSlots(
      now - 30 * 24 * 60 * 60 * 1000,
      now + 30 * 24 * 60 * 60 * 1000,
    );
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const slot of slots) {
      try {
        await ghlService.deleteEvent(slot.id);
        results.push({ id: slot.id, ok: true });
      } catch (err: any) {
        results.push({ id: slot.id, ok: false, error: err?.message || String(err) });
      }
    }
    res.json({ ok: true, total: slots.length, results });
  } catch (error: any) {
    res.status(500).json({ ok: false, message: error?.message || String(error), data: error?.response?.data });
  }
});

export default router;
