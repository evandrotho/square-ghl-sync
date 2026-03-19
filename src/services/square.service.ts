import { SquareClient, SquareEnvironment, Booking } from 'square';
import fetch from 'node-fetch';
import { config } from '../config';
import { logger } from '../utils/logger';

const client = new SquareClient({
  token: config.square.accessToken,
  environment: SquareEnvironment.Production,
  fetch: fetch as any,
});

export interface SquareBookingParams {
  startAt: string; // ISO 8601
  serviceVariationId: string;
  serviceVariationVersion: bigint | number;
  teamMemberId: string;
  customerNote?: string;
  customerId?: string;
}

export async function createBooking(params: SquareBookingParams) {
  logger.info('Creating Square booking', { startAt: params.startAt });

  const booking: Record<string, any> = {
    startAt: params.startAt,
    locationId: config.square.locationId,
    appointmentSegments: [
      {
        serviceVariationId: params.serviceVariationId,
        serviceVariationVersion: BigInt(params.serviceVariationVersion),
        teamMemberId: params.teamMemberId,
      },
    ],
  };
  if (params.customerId) booking.customerId = params.customerId;
  if (params.customerNote) booking.customerNote = params.customerNote;

  const response = await client.bookings.create({
    booking,
    idempotencyKey: `ghl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });

  logger.info('Square booking created', { bookingId: response.booking?.id });
  return response.booking;
}

export async function cancelBooking(bookingId: string) {
  logger.info('Cancelling Square booking', { bookingId });

  const existing = await client.bookings.get({ bookingId });
  const version = existing.booking?.version;

  const response = await client.bookings.cancel({
    bookingId,
    bookingVersion: version ? Number(version) : undefined,
  });

  logger.info('Square booking cancelled', { bookingId });
  return response.booking;
}

export async function getBooking(bookingId: string) {
  const response = await client.bookings.get({ bookingId });
  return response.booking;
}

export async function listRecentBookings(startAtMin: string, startAtMax: string) {
  const bookings: Booking[] = [];

  const page = await client.bookings.list({
    locationId: config.square.locationId,
    startAtMin,
    startAtMax,
  });

  for await (const booking of page) {
    bookings.push(booking);
  }

  return bookings;
}

export async function findOrCreateCustomer(email: string, name: string, phone?: string) {
  // Search by email first
  const searchResult = await client.customers.search({
    query: {
      filter: {
        emailAddress: { exact: email },
      },
    },
  });

  if (searchResult.customers && searchResult.customers.length > 0) {
    logger.info('Found existing Square customer', { customerId: searchResult.customers[0].id });
    return searchResult.customers[0];
  }

  // Create new customer
  const nameParts = name.split(' ');
  const givenName = nameParts[0] || '';
  const familyName = nameParts.slice(1).join(' ') || '';

  // Try with phone number first, fallback without if phone is invalid
  try {
    const createResult = await client.customers.create({
      givenName,
      familyName,
      emailAddress: email,
      phoneNumber: phone || undefined,
      idempotencyKey: `ghl-cust-${email}-${Date.now()}`,
    });
    logger.info('Created new Square customer', { customerId: createResult.customer?.id });
    return createResult.customer;
  } catch (error: any) {
    if (error?.errors?.[0]?.code === 'INVALID_PHONE_NUMBER' && phone) {
      logger.warn('Invalid phone number, creating customer without phone', { phone });
      const createResult = await client.customers.create({
        givenName,
        familyName,
        emailAddress: email,
        idempotencyKey: `ghl-cust-${email}-${Date.now()}-nophone`,
      });
      logger.info('Created new Square customer (no phone)', { customerId: createResult.customer?.id });
      return createResult.customer;
    }
    throw error;
  }
}

export async function getServiceVariation(serviceVariationId: string) {
  const response = await client.catalog.object.get({ objectId: serviceVariationId });
  return response.object;
}

export async function getServiceVariationVersion(serviceVariationId: string): Promise<bigint> {
  const obj = await getServiceVariation(serviceVariationId);
  if (!obj?.version) {
    throw new Error(`Service variation ${serviceVariationId} not found or has no version`);
  }
  return obj.version;
}
