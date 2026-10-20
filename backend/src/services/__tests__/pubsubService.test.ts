import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockConnect = jest.fn<() => Promise<void>>();
const mockOn = jest.fn();
const mockPublish = jest.fn<(channel: string, message: string) => Promise<number>>();
const mockSubConnect = jest.fn<() => Promise<void>>();
const mockSubOn = jest.fn();
const mockSubscribe =
  jest.fn<(channel: string, listener: (msg: string) => void) => Promise<void>>();
const mockDuplicate = jest.fn(() => ({
  connect: mockSubConnect,
  on: mockSubOn,
  subscribe: mockSubscribe,
}));

jest.unstable_mockModule('redis', () => ({
  createClient: () => ({
    connect: mockConnect,
    on: mockOn,
    publish: mockPublish,
    duplicate: mockDuplicate,
  }),
}));

const { pubsubService } = await import('../pubsubService.js');

describe('pubsubService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockPublish.mockResolvedValue(1);
    mockSubConnect.mockResolvedValue(undefined);
    mockSubscribe.mockResolvedValue(undefined);
  });

  it('publishes events using the shared Redis client', async () => {
    await pubsubService.publish({ eventId: 'evt-1', eventType: 'LoanApproved' });

    expect(mockPublish).toHaveBeenCalledWith(
      'sse:events',
      JSON.stringify({ eventId: 'evt-1', eventType: 'LoanApproved' }),
    );
  });

  it('duplicates the shared Redis client once for subscribing and forwards parsed messages', async () => {
    const onMessage = jest.fn();
    await pubsubService.initSubscriber(onMessage);

    expect(mockDuplicate).toHaveBeenCalledTimes(1);
    expect(mockSubConnect).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith('sse:events', expect.any(Function));

    const listener = mockSubscribe.mock.calls[0]?.[1];
    listener?.(JSON.stringify({ eventId: 'evt-2', eventType: 'LoanRepaid' }));

    expect(onMessage).toHaveBeenCalledWith({ eventId: 'evt-2', eventType: 'LoanRepaid' });
  });
});
