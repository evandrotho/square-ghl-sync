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

// === TEMPORARY E2E TEST ENDPOINT — REMOVE AFTER TESTING ===
router.post('/e2e-test', async (_req, res) => {
  const results: { test: string; status: string; details?: any }[] = [];
  const squareService = await import('../services/square.service');
  const ghlService = await import('../services/ghl.service');
  const db = await import('../db');

  // Create or find a test customer (Square requires customer_id for bookings)
  let testCustomerId: string | undefined;
  try {
    const customer = await squareService.findOrCreateCustomer(
      'e2e-test@squaretest.com',
      'E2E Test Customer'
    );
    testCustomerId = customer?.id;
  } catch (err: any) {
    res.json({ allPassed: false, results: [{ test: 'Setup: create test customer', status: 'FAIL', details: err?.message }] });
    return;
  }

  const testDate = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  testDate.setHours(10, 0, 0, 0);
  const startAt = testDate.toISOString();

  // --- TEST 1: GHL → Square (create) ---
  let ghlSquareBookingId: string | undefined;
  try {
    const version = await squareService.getServiceVariationVersion('PPUJOIASO3EVY2GD5FZDVMWU');
    const booking = await squareService.createBooking({
      startAt,
      serviceVariationId: 'PPUJOIASO3EVY2GD5FZDVMWU',
      serviceVariationVersion: version,
      teamMemberId: 'TMfrSx3qqoVo0r7T',
      customerId: testCustomerId,
      customerNote: 'E2E Test — GHL to Square',
    });
    ghlSquareBookingId = booking?.id;
    results.push({ test: '1. GHL→Square CREATE', status: 'PASS', details: { bookingId: ghlSquareBookingId } });
  } catch (err: any) {
    results.push({ test: '1. GHL→Square CREATE', status: 'FAIL', details: err?.message || String(err) });
  }

  // --- TEST 2: GHL → Square (cancel) ---
  if (ghlSquareBookingId) {
    try {
      await squareService.cancelBooking(ghlSquareBookingId);
      const cancelled = await squareService.getBooking(ghlSquareBookingId);
      const isCancelled = cancelled?.status?.includes('CANCELLED');
      results.push({
        test: '2. GHL→Square CANCEL',
        status: isCancelled ? 'PASS' : 'FAIL',
        details: { bookingId: ghlSquareBookingId, status: cancelled?.status },
      });
    } catch (err: any) {
      results.push({ test: '2. GHL→Square CANCEL', status: 'FAIL', details: err?.message || String(err) });
    }
  }

  // --- TEST 3: Square → GHL (create block slot) ---
  let squareTestBookingId: string | undefined;
  let ghlBlockSlotId: string | undefined;
  try {
    const version = await squareService.getServiceVariationVersion('PPUJOIASO3EVY2GD5FZDVMWU');
    const testDate2 = new Date(Date.now() + 8 * 24 * 60 * 60_000);
    testDate2.setHours(11, 0, 0, 0);
    const booking = await squareService.createBooking({
      startAt: testDate2.toISOString(),
      serviceVariationId: 'PPUJOIASO3EVY2GD5FZDVMWU',
      serviceVariationVersion: version,
      teamMemberId: 'TMfrSx3qqoVo0r7T',
      customerId: testCustomerId,
      customerNote: 'E2E Test — Square to GHL',
    });
    squareTestBookingId = booking?.id;

    const seg = booking?.appointmentSegments?.[0];
    const durMin = seg ? Number(seg.durationMinutes || 90) : 90;
    const endAt2 = new Date(testDate2.getTime() + durMin * 60_000).toISOString();

    const ghlEvent = await ghlService.createBlockSlot({
      title: '[Square] E2E Test',
      startTime: testDate2.toISOString(),
      endTime: endAt2,
    });
    ghlBlockSlotId = ghlEvent?.id || ghlEvent?.event?.id;

    db.createMapping({
      square_booking_id: squareTestBookingId!,
      ghl_event_id: ghlBlockSlotId!,
      source: 'square',
      status: 'active',
      square_service_variation_id: 'PPUJOIASO3EVY2GD5FZDVMWU',
      square_team_member_id: 'TMfrSx3qqoVo0r7T',
    });

    results.push({
      test: '3. Square→GHL CREATE (block slot)',
      status: ghlBlockSlotId ? 'PASS' : 'FAIL',
      details: { squareBookingId: squareTestBookingId, ghlBlockSlotId },
    });
  } catch (err: any) {
    results.push({ test: '3. Square→GHL CREATE', status: 'FAIL', details: err?.message || String(err) });
  }

  // --- TEST 4: Square → GHL (cancel = delete block slot) ---
  if (squareTestBookingId && ghlBlockSlotId) {
    try {
      await squareService.cancelBooking(squareTestBookingId);
      await ghlService.deleteEvent(ghlBlockSlotId);
      db.deactivateBySquareId(squareTestBookingId);

      results.push({
        test: '4. Square→GHL CANCEL (delete block slot)',
        status: 'PASS',
        details: { squareBookingId: squareTestBookingId, ghlBlockSlotDeleted: ghlBlockSlotId },
      });
    } catch (err: any) {
      results.push({ test: '4. Square→GHL CANCEL', status: 'FAIL', details: err?.message || String(err) });
    }
  }

  const allPassed = results.every(r => r.status === 'PASS');
  res.json({ allPassed, results });
});

export default router;
