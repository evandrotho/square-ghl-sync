import crypto from 'crypto';
import { config } from '../config';

export function isValidSquareWebhook(
  body: string,
  signature: string,
  url: string
): boolean {
  const hmac = crypto.createHmac('sha256', config.square.webhookSignatureKey);
  hmac.update(url + body);
  const expected = hmac.digest('base64');
  return expected === signature;
}
