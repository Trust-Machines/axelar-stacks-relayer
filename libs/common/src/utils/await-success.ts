import { Logger } from '@nestjs/common';
import { AxiosError } from 'axios';

export async function awaitSuccess<T>(
  id: string,
  timeoutMillis: number,
  intervalMillis: number,
  key: string,
  fetch: (identifier: string) => Promise<T>,
  checkCondition: (result: T) => boolean,
  logger?: Logger,
): Promise<{ success: boolean; result: T | null }> {
  try {
    const result = await poll(id, timeoutMillis, intervalMillis, key, fetch, checkCondition);

    if (!result) {
      return { success: false, result: null };
    }

    return { success: true, result: result };
  } catch (error) {
    logger?.error(`Cannot await success for key: ${key}`);
    logger?.error(error);

    if (error instanceof AxiosError) {
      logger?.error(error.response?.data);
    }

    return { success: false, result: null };
  }
}

async function poll<T>(
  identifier: string,
  timeoutMillis: number,
  intervalMillis: number,
  key: string,
  fetch: (identifier: string) => Promise<T>,
  checkCondition: (result: T) => boolean,
): Promise<T> {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeoutMillis) {
    try {
      const result = await fetch(identifier);

      if (checkCondition(result)) {
        return result;
      }

      await delay(intervalMillis);
    } catch (error) {
      throw new Error(`Error while polling ${key}: ${error}`);
    }
  }

  throw new Error(`Polling timed out after ${timeoutMillis / 1000} seconds for ${key}`);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
