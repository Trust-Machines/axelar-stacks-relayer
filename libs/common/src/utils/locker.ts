import { Logger } from '@nestjs/common';

export class Locker {
  private static lockSet: Set<string> = new Set();

  static async lock(key: string, func: () => Promise<void>): Promise<LockResult> {
    const logger = new Logger('Lock');

    if (Locker.lockSet.has(key)) {
      logger.log(`${key} is already running`);
      return LockResult.ALREADY_RUNNING;
    }

    Locker.lockSet.add(key);

    try {
      await func();

      return LockResult.SUCCESS;
    } catch (error) {
      logger.error(`Error running ${key}`);
      logger.error(error);

      return LockResult.ERROR;
    } finally {
      Locker.lockSet.delete(key);
    }
  }
}

export enum LockResult {
  SUCCESS = 'success',
  ALREADY_RUNNING = 'alreadyRunning',
  ERROR = 'error',
}
