import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import './DispatchFeed.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:3000';

const statusClassMap = {
  Dispatched: 'status-dispatched',
  Completed: 'status-completed',
  Cancelled: 'status-cancelled',
  'En-route': 'status-enroute'
};

function toKey(event, index) {
  return event.id || `${event.timestamp}-${event.type}-${index}`;
}

function mergeEvents(currentEvents, incomingEvents) {
  const merged = [...currentEvents];
  incomingEvents.forEach((event) => {
    const exists = merged.some((entry) => entry.id && event.id && entry.id === event.id);
    if (!exists) {
      merged.push(event);
    }
  });
  return merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export default function DispatchFeed() {
  const [events, setEvents] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('Connecting');
  const feedRef = useRef(null);
  const lastSeenRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    async function loadInitial() {
      try {
        const response = await fetch(`${API_BASE}/api/dispatch/live`);
        const data = await response.json();
        if (isMounted && Array.isArray(data)) {
          setEvents(data);
          lastSeenRef.current = data.length ? data[data.length - 1].timestamp : null;
        }
      } catch (error) {
        if (isMounted) {
          setConnectionStatus('API Unavailable');
        }
      }
    }
    loadInitial();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const socket = io(API_BASE, {
      transports: ['websocket'],
      auth: { lastSeen: lastSeenRef.current }
    });

    socket.on('connect', () => setConnectionStatus('Live'));
    socket.on('disconnect', () => setConnectionStatus('Reconnecting'));

    socket.on('dispatch.snapshot', (snapshot) => {
      if (Array.isArray(snapshot)) {
        setEvents((current) => mergeEvents(current, snapshot));
      }
    });

    socket.on('dispatch.replay', (replay) => {
      if (Array.isArray(replay)) {
        setEvents((current) => mergeEvents(current, replay));
      }
    });

    socket.on('dispatch.activity', (event) => {
      setEvents((current) => {
        const next = mergeEvents(current, [event]);
        lastSeenRef.current = next.length ? next[next.length - 1].timestamp : null;
        return next;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTo({
        top: feedRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
    if (events.length) {
      lastSeenRef.current = events[events.length - 1].timestamp;
    }
  }, [events]);

  const feedRows = useMemo(
    () =>
      events.map((event, index) => {
        const statusClass = statusClassMap[event.type] || 'status-default';
        return (
          <div key={toKey(event, index)} className="feed-row fade-in">
            <span className="feed-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
            <span className={`feed-status ${statusClass}`}>{event.type}</span>
            <span className="feed-text">{event.text}</span>
          </div>
        );
      }),
    [events]
  );

  return (
    <section className="dispatch-feed-panel">
      <div className="dispatch-feed-header">
        <h2>Live Dispatch Feed</h2>
        <span className="connection-pill">{connectionStatus}</span>
      </div>
      <div ref={feedRef} className="dispatch-feed-scroll">
        {feedRows}
      </div>
    </section>
  );
}
