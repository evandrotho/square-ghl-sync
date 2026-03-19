import { Request, Response } from 'express';
import { isDuplicate } from '../utils/loop-guard';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';
import * as squareService from '../services/square.service';
import * as ghlService from '../services/ghl.service';
import { createMapping, findByGhlId, deactivateByGhlId } from '../db';
import { config } from '../config';

// Default service variation (first bookable service from Square)
// Version is fetched dynamically from Square API to avoid stale values
const DEFAULT_SERVICE_VARIATION_ID = 'PPUJOIASO3EVY2GD5FZDVMWU'; // Essential Full Grooming
const DEFAULT_TEAM_MEMBER_ID = 'TMfrSx3qqoVo0r7T'; // Essential Groomer 1

export async function handleGhlCreated(req: Request, res: Response) {
  const body = req.body;
  const appointmentId = body.appointment_id || body.id;

  if (!appointmentId) {
    return res.status(200).json({ ok: true, message: 'No appointment ID' });
  }

  const guardKey = `ghl-created-${appointmentId}`;
  if (isDuplicate(guardKey)) {
    logger.info('Duplicate GHL created event, skipping', { appointmentId });
    return res.status(200).json({ ok: true, message: 'Duplicate, skipped' });
  }

  // Already mapped?
  if (findByGhlId(appointmentId)) {
    logger.info('GHL appointment already mapped, skipping', { appointmentId });
    return res.status(200).json({ ok: true, message: 'Already mapped' });
  }

  try {
    const contactName = body.contact_name || body.full_name || 'GHL Client';
    const contactEmail = body.contact_email || body.email || '';
    const contactPhone = body.contact_phone || body.phone || '';
    const startTime = body.appointment_start || body.start_time || body.startTime;
    const endTime = body.appointment_end || body.end_time || body.endTime;

    if (!startTime) {
      logger.warn('No start time in GHL webhook', { body });
      return res.status(200).json({ ok: true, message: 'No start time' });
    }

    // Find or create customer in Square
    let customerId: string | undefined;
    if (contactEmail) {
      const customer = await withRetry(
        () => squareService.findOrCreateCustomer(contactEmail, contactName, contactPhone),
        'Find/create Square customer'
      );
      customerId = customer?.id;
    }

    // Fetch current service variation version from Square (avoids stale hardcoded version)
    const currentVersion = await withRetry(
      () => squareService.getServiceVariationVersion(DEFAULT_SERVICE_VARIATION_ID),
      'Get service variation version'
    );

    // Create real booking in Square
    const booking = await withRetry(
      () => squareService.createBooking({
        startAt: new Date(startTime).toISOString(),
        serviceVariationId: DEFAULT_SERVICE_VARIATION_ID,
        serviceVariationVersion: currentVersion,
        teamMemberId: DEFAULT_TEAM_MEMBER_ID,
        customerId,
        customerNote: `Booked via GHL — ${contactName}`,
      }),
      'Create Square booking'
    );

    createMapping({
      square_booking_id: booking?.id || null,
      ghl_event_id: appointmentId,
      source: 'ghl',
      status: 'active',
      square_service_variation_id: DEFAULT_SERVICE_VARIATION_ID,
      square_team_member_id: DEFAULT_TEAM_MEMBER_ID,
    });

    logger.info('GHL->Square sync complete', { appointmentId, squareBookingId: booking?.id });
    res.status(200).json({ ok: true, squareBookingId: booking?.id });
  } catch (error: any) {
    logger.error('Error in GHL->Square sync', {
      appointmentId,
      message: error?.message || String(error),
      statusCode: error?.statusCode,
      errors: error?.errors,
    });
    res.status(500).json({ error: 'Internal error' });
  }
}

export async function handleGhlCancelled(req: Request, res: Response) {
  const body = req.body;
  const appointmentId = body.appointment_id || body.id;

  if (!appointmentId) {
    return res.status(200).json({ ok: true, message: 'No appointment ID' });
  }

  const guardKey = `ghl-cancelled-${appointmentId}`;
  if (isDuplicate(guardKey)) {
    return res.status(200).json({ ok: true, message: 'Duplicate, skipped' });
  }

  try {
    const mapping = findByGhlId(appointmentId);
    if (mapping?.square_booking_id) {
      await withRetry(
        () => squareService.cancelBooking(mapping.square_booking_id!),
        'Cancel Square booking'
      );
      deactivateByGhlId(appointmentId);
      logger.info('GHL cancellation synced to Square', { appointmentId, squareId: mapping.square_booking_id });
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Error cancelling Square booking from GHL', { error, appointmentId });
    res.status(500).json({ error: 'Internal error' });
  }
}

export async function handleGhlUpdated(req: Request, res: Response) {
  const body = req.body;
  const appointmentId = body.appointment_id || body.id;

  if (!appointmentId) {
    return res.status(200).json({ ok: true, message: 'No appointment ID' });
  }

  const guardKey = `ghl-updated-${appointmentId}`;
  if (isDuplicate(guardKey)) {
    return res.status(200).json({ ok: true, message: 'Duplicate, skipped' });
  }

  try {
    const mapping = findByGhlId(appointmentId);
    if (mapping?.square_booking_id) {
      // Cancel old booking and create new one with updated time
      await squareService.cancelBooking(mapping.square_booking_id);
      deactivateByGhlId(appointmentId);

      // Re-create with new time
      const startTime = body.appointment_start || body.start_time || body.startTime;
      const contactName = body.contact_name || body.full_name || 'GHL Client';
      const contactEmail = body.contact_email || body.email || '';

      if (startTime) {
        let customerId: string | undefined;
        if (contactEmail) {
          const customer = await squareService.findOrCreateCustomer(contactEmail, contactName);
          customerId = customer?.id;
        }

        const serviceVarId = mapping.square_service_variation_id || DEFAULT_SERVICE_VARIATION_ID;
        const updatedVersion = await squareService.getServiceVariationVersion(serviceVarId);

        const newBooking = await squareService.createBooking({
          startAt: new Date(startTime).toISOString(),
          serviceVariationId: serviceVarId,
          serviceVariationVersion: updatedVersion,
          teamMemberId: mapping.square_team_member_id || DEFAULT_TEAM_MEMBER_ID,
          customerId,
          customerNote: `Rescheduled via GHL — ${contactName}`,
        });

        createMapping({
          square_booking_id: newBooking?.id || null,
          ghl_event_id: appointmentId,
          source: 'ghl',
          status: 'active',
          square_service_variation_id: mapping.square_service_variation_id || DEFAULT_SERVICE_VARIATION_ID,
          square_team_member_id: mapping.square_team_member_id || DEFAULT_TEAM_MEMBER_ID,
        });
      }
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Error updating Square booking from GHL', { error, appointmentId });
    res.status(500).json({ error: 'Internal error' });
  }
}
