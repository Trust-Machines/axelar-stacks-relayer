import { Logger } from '@nestjs/common';
import { awaitSuccess } from './await-success';

describe('awaitSuccess', () => {
  const mockLogger = new Logger('TestLogger');
  mockLogger.error = jest.fn();

  const identifier = 'test-id';
  const key = 'test-key';
  const timeoutMillis = 2000;
  const intervalMillis = 500;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return success if condition is met within timeout', async () => {
    const fetch = jest.fn().mockResolvedValue({ status: 'SUCCESS' });
    const checkCondition = jest.fn().mockImplementation((result) => result.status === 'SUCCESS');

    const result = await awaitSuccess(
      identifier,
      timeoutMillis,
      intervalMillis,
      key,
      fetch,
      checkCondition,
      mockLogger,
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ status: 'SUCCESS' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('should return failure if polling times out', async () => {
    const fetch = jest.fn().mockResolvedValue({ status: 'PENDING' });
    const checkCondition = jest.fn().mockImplementation((result) => result.status === 'SUCCESS');

    const result = await awaitSuccess(
      identifier,
      timeoutMillis,
      intervalMillis,
      key,
      fetch,
      checkCondition,
      mockLogger,
    );

    expect(result.success).toBe(false);
    expect(result.result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(Math.ceil(timeoutMillis / intervalMillis));
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Cannot await success for key'));
  });

  it('should handle errors in fetch function', async () => {
    const fetch = jest.fn().mockRejectedValue(new Error('Fetch Error'));
    const checkCondition = jest.fn().mockReturnValue(false);

    const result = await awaitSuccess(
      identifier,
      timeoutMillis,
      intervalMillis,
      key,
      fetch,
      checkCondition,
      mockLogger,
    );

    expect(result.success).toBe(false);
    expect(result.result).toBeNull();
    expect(fetch).toHaveBeenCalled();
  });
});
