import { logger } from './logger';

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        logger.error(`${label} failed after ${maxRetries} attempts`, { error });
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn(`${label} attempt ${attempt} failed, retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}
