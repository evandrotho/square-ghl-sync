import { z } from 'zod';

const envSchema = z.object({
  SQUARE_ACCESS_TOKEN: z.string().min(1),
  SQUARE_APPLICATION_ID: z.string().min(1),
  SQUARE_LOCATION_ID: z.string().min(1),
  SQUARE_WEBHOOK_SIGNATURE_KEY: z.string().min(1),

  GHL_API_TOKEN: z.string().min(1),
  GHL_LOCATION_ID: z.string().min(1),
  GHL_CALENDAR_ID: z.string().min(1),
  GHL_USER_ID: z.string().min(1),

  PORT: z.string().default('3000'),
  NODE_ENV: z.string().default('production'),
  RECONCILIATION_INTERVAL_MINUTES: z.string().default('15'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Missing environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  square: {
    accessToken: parsed.data.SQUARE_ACCESS_TOKEN,
    applicationId: parsed.data.SQUARE_APPLICATION_ID,
    locationId: parsed.data.SQUARE_LOCATION_ID,
    webhookSignatureKey: parsed.data.SQUARE_WEBHOOK_SIGNATURE_KEY,
  },
  ghl: {
    apiToken: parsed.data.GHL_API_TOKEN,
    locationId: parsed.data.GHL_LOCATION_ID,
    calendarId: parsed.data.GHL_CALENDAR_ID,
    userId: parsed.data.GHL_USER_ID,
  },
  port: parseInt(parsed.data.PORT, 10),
  nodeEnv: parsed.data.NODE_ENV,
  reconciliationIntervalMinutes: parseInt(parsed.data.RECONCILIATION_INTERVAL_MINUTES, 10),
};
