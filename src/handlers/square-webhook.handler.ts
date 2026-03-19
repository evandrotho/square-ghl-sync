import { Request, Response } from 'express';
import { isDuplicate } from '../utils/loop-guard';
import { withRetry } from '../utils/retry';
import { isValidSquareWebhook } from '../utils/webhook-validator';
import { logger } from '../utils/logger';
import * as squareService from '../services/square.service';
import * as ghlService from '../services/ghl.service';
import { createMapping, findBySquareId, deactivateBySquareId } from '../db';

export async function handleSquareWebhook(req: Request, res: Response) {
  const signature = req.headers['x-square-hmacsha256-signature'] as string;
  const rawBody = (req as any).rawBody as string;
  const notificationUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  if (!isValidSquareWebhook(rawBody, signature, notificationUrl)) {
    logger.warn('Invalid Square webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  const eventType = event?.type;
  const bookingId = event?.data?.object?.booking?.id || event?.data?.id;

  if (!bookingId) {
    return res.status(200).json({ ok: true, message: 'No booking ID' });
  }

  // Loop guard — ignore events triggered by our own sync
  const guardKey = `square-${bookingId}-${eventType}`;
  if (isDuplicate(guardKey)) {
    logger.info('Duplicate Square event, skipping', { bookingId, eventType });
    return res.status(200).json({ ok: true, message: 'Duplicate, skipped' });
  }

  try {
    if (eventType === 'booking.created') {
      await handleBookingCreated(bookingId);
    } else if (eventType === 'booking.updated') {
      await handleBookingUpdated(bookingId);
    }

    res.status(200).json({ ok: true });
  } catch (error: any) {
    logger.error('Error handling Square webhook', {
      bookingId,
      eventType,
      message: error?.message || String(error),
      stack: error?.stack,
      statusCode: error?.statusCode,
      body: error?.body,
      errors: error?.errors,
    });
    res.status(500).json({ error: 'Internal error' });
  }
}

async function handleBookingCreated(bookingId: string) {
  // Check if already mapped (e.g. created by our GHL->Square sync)
  if (findBySquareId(bookingId)) {
    logger.info('Square booking already mapped, skipping', { bookingId });
    return;
  }

  const booking = await squareService.getBooking(bookingId);
  if (!booking) {
    logger.warn('Square booking not found', { bookingId });
    return;
  }

  const startAt = booking.startAt;
  const segment = booking.appointmentSegments?.[0];
  const durationMinutes = segment ? Number(segment.durationMinutes || 60) : 60;
  const endAt = new Date(new Date(startAt!).getTime() + durationMinutes * 60_000).toISOString();

  const customerName = booking.customerNote || 'Square Booking';
  const title = `[Square] ${customerName}`;

  const ghlEvent = await withRetry(
    () => ghlService.createBlockSlot({ title, startTime: startAt!, endTime: endAt }),
    'Create GHL block slot'
  );

  createMapping({
    square_booking_id: bookingId,
    ghl_event_id: ghlEvent.id || ghlEvent.event?.id,
    source: 'square',
    status: 'active',
    square_service_variation_id: segment?.serviceVariationId,
    square_team_member_id: segment?.teamMemberId,
  });
}

async function handleBookingUpdated(bookingId: string) {
  const booking = await squareService.getBooking(bookingId);
  if (!booking) return;

  const mapping = findBySquareId(bookingId);

  // If cancelled
  if (booking.status === 'CANCELLED_BY_CUSTOMER' || booking.status === 'CANCELLED_BY_SELLER') {
    if (mapping?.ghl_event_id) {
      await withRetry(
        () => ghlService.deleteEvent(mapping.ghl_event_id!),
        'Delete GHL event'
      );
      deactivateBySquareId(bookingId);
    }
    return;
  }

  // If rescheduled — update GHL event
  if (mapping?.ghl_event_id) {
    const startAt = booking.startAt;
    const segment = booking.appointmentSegments?.[0];
    const durationMinutes = segment ? Number(segment.durationMinutes || 60) : 60;
    const endAt = new Date(new Date(startAt!).getTime() + durationMinutes * 60_000).toISOString();

    await withRetry(
      () => ghlService.updateEvent(mapping.ghl_event_id!, { startTime: startAt!, endTime: endAt }),
      'Update GHL event'
    );
  } else {
    // New booking not yet mapped — create mapping
    await handleBookingCreated(bookingId);
  }
}
