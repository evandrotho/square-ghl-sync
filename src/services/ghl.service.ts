import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

const api: AxiosInstance = axios.create({
  baseURL: 'https://services.leadconnectorhq.com',
  headers: {
    Authorization: `Bearer ${config.ghl.apiToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Version: '2021-07-28',
  },
});

export interface GhlAppointmentParams {
  title: string;
  startTime: string; // ISO 8601
  endTime: string;   // ISO 8601
  contactId?: string;
  notes?: string;
}

export async function createBlockSlot(params: GhlAppointmentParams) {
  logger.info('Creating GHL block slot', { startTime: params.startTime });

  const response = await api.post('/calendars/events/block-slots', {
    locationId: config.ghl.locationId,
    title: params.title,
    startTime: params.startTime,
    endTime: params.endTime,
    assignedUserId: config.ghl.userId,
  });

  logger.info('GHL block slot created', { eventId: response.data?.id });
  return response.data;
}

export async function createAppointment(params: GhlAppointmentParams) {
  logger.info('Creating GHL appointment', { startTime: params.startTime });

  const response = await api.post('/calendars/events/appointments', {
    calendarId: config.ghl.calendarId,
    locationId: config.ghl.locationId,
    contactId: params.contactId,
    title: params.title,
    startTime: params.startTime,
    endTime: params.endTime,
    assignedUserId: config.ghl.userId,
    appointmentStatus: 'new',
    toNotify: false,
    notes: params.notes,
  });

  logger.info('GHL appointment created', { eventId: response.data?.id });
  return response.data;
}

export async function deleteEvent(eventId: string) {
  logger.info('Deleting GHL event', { eventId });

  await api.delete(`/calendars/events/appointments/${eventId}`);

  logger.info('GHL event deleted', { eventId });
}

export async function updateEvent(eventId: string, params: Partial<GhlAppointmentParams>) {
  logger.info('Updating GHL event', { eventId });

  const response = await api.put(`/calendars/events/appointments/${eventId}`, {
    calendarId: config.ghl.calendarId,
    ...params,
  });

  logger.info('GHL event updated', { eventId });
  return response.data;
}

export async function listEvents(startTime: string, endTime: string) {
  const response = await api.get('/calendars/events', {
    params: {
      locationId: config.ghl.locationId,
      calendarId: config.ghl.calendarId,
      startTime,
      endTime,
    },
  });

  return response.data?.events || [];
}

export async function findOrCreateContact(email: string, name: string, phone?: string) {
  // Search by email
  const searchResponse = await api.get('/contacts/', {
    params: {
      locationId: config.ghl.locationId,
      query: email,
    },
  });

  const contacts = searchResponse.data?.contacts || [];
  if (contacts.length > 0) {
    logger.info('Found existing GHL contact', { contactId: contacts[0].id });
    return contacts[0];
  }

  // Create new contact
  const nameParts = name.split(' ');
  const createResponse = await api.post('/contacts/', {
    locationId: config.ghl.locationId,
    firstName: nameParts[0] || '',
    lastName: nameParts.slice(1).join(' ') || '',
    email,
    phone,
    source: 'Square Appointments',
  });

  logger.info('Created new GHL contact', { contactId: createResponse.data?.contact?.id });
  return createResponse.data?.contact;
}
