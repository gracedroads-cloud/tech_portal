import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { io } from 'socket.io-client';
import DispatchFeed from './DispatchFeed';

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

describe('DispatchFeed', () => {
  let handlers;
  let ioHandlers;
  let socket;
  let recognition;

  beforeEach(() => {
    handlers = {};
    ioHandlers = {};
    recognition = null;
    HTMLElement.prototype.scrollTo = jest.fn();

    socket = {
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
      disconnect: jest.fn(),
      io: {
        on: jest.fn((event, handler) => {
          ioHandlers[event] = handler;
        })
      }
    };

    io.mockReturnValue(socket);
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => []
      })
    );

    class MockSpeechRecognition {
      constructor() {
        recognition = this;
        this.start = jest.fn();
        this.stop = jest.fn();
      }
    }

    window.SpeechRecognition = MockSpeechRecognition;
    delete window.webkitSpeechRecognition;
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete window.SpeechRecognition;
    delete global.fetch;
  });

  test('merges fetched events with live socket state and keeps the newest lastSeen value', async () => {
    const fetchDeferred = createDeferred();
    const liveEvent = {
      id: 'live-1',
      timestamp: '2026-09-20T12:00:00.000Z',
      type: 'Dispatched',
      text: 'Live dispatch'
    };
    const fetchedEvent = {
      id: 'api-1',
      timestamp: '2026-09-20T11:55:00.000Z',
      type: 'Completed',
      text: 'Fetched dispatch'
    };

    global.fetch = jest.fn(() => fetchDeferred.promise);

    render(<DispatchFeed />);

    await waitFor(() => expect(handlers['dispatch.activity']).toEqual(expect.any(Function)));
    await waitFor(() => expect(ioHandlers.reconnect_attempt).toEqual(expect.any(Function)));

    act(() => {
      handlers['dispatch.activity'](liveEvent);
    });

    expect(await screen.findByText('Live dispatch')).toBeInTheDocument();

    await act(async () => {
      fetchDeferred.resolve({
        ok: true,
        json: async () => [fetchedEvent]
      });
    });

    expect(await screen.findByText('Fetched dispatch')).toBeInTheDocument();
    expect(screen.getByText('Live dispatch')).toBeInTheDocument();

    act(() => {
      ioHandlers.reconnect_attempt();
    });

    expect(socket.auth).toEqual({ lastSeen: liveEvent.timestamp });
  });

  test('keeps retrying hands-free mode only for transient recognition errors', async () => {
    render(<DispatchFeed />);

    await waitFor(() => expect(recognition).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /talk freely/i }));

    expect(recognition.start).toHaveBeenCalledTimes(1);

    act(() => {
      recognition.onerror({ error: 'network' });
      recognition.onend();
    });

    expect(recognition.start).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: /stop hands-free/i })).toBeInTheDocument();
  });

  test('disables hands-free retries on terminal recognition errors', async () => {
    render(<DispatchFeed />);

    await waitFor(() => expect(recognition).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /talk freely/i }));

    expect(recognition.start).toHaveBeenCalledTimes(1);

    act(() => {
      recognition.onerror({ error: 'audio-capture' });
      recognition.onend();
    });

    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /talk freely/i })).toBeInTheDocument();
    expect(screen.getByText('Voice Error')).toBeInTheDocument();
  });

  test('does not auto-retry hands-free on unclassified recognition errors', async () => {
    render(<DispatchFeed />);

    await waitFor(() => expect(recognition).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /talk freely/i }));

    expect(recognition.start).toHaveBeenCalledTimes(1);

    act(() => {
      recognition.onerror({ error: 'unexpected-error' });
      recognition.onend();
    });

    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /stop hands-free/i })).toBeInTheDocument();
    expect(screen.getByText('Voice Error')).toBeInTheDocument();
  });

  test('supports accessible Grace and pointer plus keyboard PTT controls', async () => {
    render(<DispatchFeed />);

    await waitFor(() => expect(recognition).not.toBeNull());

    expect(
      screen.getByRole('button', { name: /activate grace voice assistant/i })
    ).toBeInTheDocument();

    const pttButton = screen.getByRole('button', { name: /hold to talk/i });

    fireEvent.pointerDown(pttButton, { button: 0, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerDown(pttButton, { button: 0, pointerId: 1, pointerType: 'mouse' });
    expect(recognition.start).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(pttButton, { button: 0, pointerId: 1, pointerType: 'mouse' });
    expect(recognition.stop).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(pttButton, { key: 'Enter' });
    expect(recognition.start).toHaveBeenCalledTimes(2);

    fireEvent.keyUp(pttButton, { key: 'Enter' });
    expect(recognition.stop).toHaveBeenCalledTimes(2);
  });
});
