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

export default router;
