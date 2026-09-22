import { act, render, screen, waitFor } from '@testing-library/react';
import { io } from 'socket.io-client';
import BreakdownAlertsMonitor from './BreakdownAlertsMonitor';

jest.mock('socket.io-client', () => ({
  io: jest.fn()
}));

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

describe('BreakdownAlertsMonitor', () => {
  let handlers;

  beforeEach(() => {
    handlers = {};
    HTMLElement.prototype.scrollTo = jest.fn();
    io.mockReturnValue({
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
      disconnect: jest.fn()
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('merges fetched alerts with live alerts received during startup', async () => {
    const fetchDeferred = createDeferred();
    const liveAlert = {
      id: 'live-1',
      sourceRef: 'live-1',
      priority: 'high',
      timestamp: '2026-09-20T12:00:00.000Z',
      location: 'Live Yard',
      vehicle: 'Unit 7',
      cause: 'Battery',
      source: 'telematics',
      lat: 40.7,
      lng: -75.22
    };
    const fetchedAlert = {
      id: 'api-1',
      sourceRef: 'api-1',
      priority: 'medium',
      timestamp: '2026-09-20T11:55:00.000Z',
      location: 'API Depot',
      vehicle: 'Unit 9',
      cause: 'Flat tire',
      source: 'dispatch',
      lat: 40.69,
      lng: -75.23
    };

    global.fetch = jest.fn(() => fetchDeferred.promise);

    render(<BreakdownAlertsMonitor />);

    await waitFor(() => expect(handlers['breakdown.alerts']).toEqual(expect.any(Function)));

    act(() => {
      handlers['breakdown.alerts'](liveAlert);
    });

    expect(await screen.findByText('Live Yard')).toBeInTheDocument();

    await act(async () => {
      fetchDeferred.resolve({
        ok: true,
        json: async () => ({ alerts: [fetchedAlert] })
      });
    });

    expect(await screen.findByText('API Depot')).toBeInTheDocument();
    expect(screen.getByText('Live Yard')).toBeInTheDocument();
  });
});
