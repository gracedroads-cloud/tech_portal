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

const intelligenceProfiles = {
  adaptive: { label: 'Adaptive', multiplier: 1 },
  strategic: { label: 'Strategic', multiplier: 1.4 },
  apex: { label: 'Apex Growth', multiplier: 2 }
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
  const [voiceStatus, setVoiceStatus] = useState('Voice Offline');
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(false);
  const [faceMood, setFaceMood] = useState('calm');
  const [intelligenceLevel, setIntelligenceLevel] = useState('apex');
  const [interactionCount, setInteractionCount] = useState(0);
  const feedRef = useRef(null);
  const lastSeenRef = useRef(null);
  const recognitionRef = useRef(null);
  const handsFreeRef = useRef(false);
  const blockAutoRestartRef = useRef(false);

  function injectVoiceEvent(text, mode = 'Hands-Free') {
    const voiceEvent = {
      id: `VOICE-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: mode === 'PTT' ? 'En-route' : 'Dispatched',
      text: `Grace Voice (${mode}) — ${text}`
    };
    setEvents((current) => mergeEvents(current, [voiceEvent]));
    setInteractionCount((value) => value + 1);
  }

  function startRecognition(mode) {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.continuous = mode === 'Hands-Free';
      recognition.start();
      setVoiceStatus(mode === 'Hands-Free' ? 'Hands-Free Listening' : 'PTT Listening');
    } catch (error) {
      setVoiceStatus('Voice Busy');
    }
  }

  function stopRecognition() {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.stop();
    setVoiceStatus(handsFreeRef.current ? 'Hands-Free Listening' : 'Voice Ready');
  }

  useEffect(() => {
    handsFreeRef.current = handsFreeEnabled;
  }, [handsFreeEnabled]);

  useEffect(() => {
    if (voiceStatus.includes('Error') || voiceStatus.includes('Unsupported')) {
      setFaceMood('alert');
      return;
    }
    if (voiceStatus.includes('Listening')) {
      setFaceMood('listening');
      return;
    }
    if (handsFreeEnabled) {
      setFaceMood('warm');
      return;
    }
    setFaceMood('calm');
  }, [voiceStatus, handsFreeEnabled]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceSupported(false);
      setVoiceStatus('Voice Unsupported');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      setVoiceSupported(true);
    };

    recognition.onresult = (event) => {
      const latest = event.results[event.resultIndex];
      const transcript = latest?.[0]?.transcript?.trim() || '';
      if (transcript && latest?.isFinal) {
        injectVoiceEvent(transcript, handsFreeRef.current ? 'Hands-Free' : 'PTT');
      }
    };

    recognition.onerror = (event) => {
      const fatalErrors = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'aborted']);
      const errorCode = String(event?.error || '');
      blockAutoRestartRef.current = fatalErrors.has(errorCode);
      if (blockAutoRestartRef.current) {
        handsFreeRef.current = false;
        setHandsFreeEnabled(false);
      }
      setVoiceStatus('Voice Error');
    };

    recognition.onend = () => {
      if (handsFreeRef.current && !blockAutoRestartRef.current) {
        startRecognition('Hands-Free');
      } else {
        blockAutoRestartRef.current = false;
        setVoiceStatus('Voice Ready');
      }
    };

    recognitionRef.current = recognition;
    setVoiceSupported(true);
    setVoiceStatus('Voice Ready');

    return () => {
      handsFreeRef.current = false;
      recognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function loadInitial() {
      try {
        const response = await fetch(`${API_BASE}/api/dispatch/live`);
        if (!response.ok) {
          throw new Error(`Dispatch feed unavailable: ${response.status}`);
        }
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
    socket.io.on('reconnect_attempt', () => {
      socket.auth = { lastSeen: lastSeenRef.current };
    });

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

  const intelligenceScore = useMemo(() => {
    const profile = intelligenceProfiles[intelligenceLevel];
    return Math.round((events.length + interactionCount * 4) * profile.multiplier);
  }, [events.length, interactionCount, intelligenceLevel]);

  function handleFaceInteract() {
    injectVoiceEvent('Grace is ready. You can speak now.', 'Hands-Free');
    setFaceMood('warm');
    setVoiceStatus(handsFreeEnabled ? 'Hands-Free Listening' : 'Voice Ready');
  }

  return (
    <section className="dispatch-feed-panel">
      <div className="dispatch-feed-header">
        <div>
          <h2>Live Dispatch Feed</h2>
          <span className="connection-pill">{connectionStatus}</span>
        </div>
        <div className="voice-controls">
          <button
            type="button"
            className={`grace-face grace-face-${faceMood}`}
            onClick={handleFaceInteract}
            aria-label="Activate Grace voice assistant"
          >
            <span className="face-halo" />
            <span className="face-core">
              <span className="face-eyes">
                <span className="face-eye" />
                <span className="face-eye" />
              </span>
              <span className="face-mouth" />
              <span className="face-cheek face-cheek-left" />
              <span className="face-cheek face-cheek-right" />
            </span>
          </button>
          <button
            type="button"
            className="voice-btn"
            disabled={!voiceSupported}
            onMouseDown={() => startRecognition('PTT')}
            onMouseUp={stopRecognition}
            onMouseLeave={stopRecognition}
            onTouchStart={() => startRecognition('PTT')}
            onTouchEnd={stopRecognition}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                startRecognition('PTT');
              }
            }}
            onKeyUp={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                stopRecognition();
              }
            }}
          >
            Hold to Talk (PTT)
          </button>
          <button
            type="button"
            className={`voice-btn ${handsFreeEnabled ? 'voice-btn-active' : ''}`}
            disabled={!voiceSupported}
            onClick={() => {
              const next = !handsFreeEnabled;
              handsFreeRef.current = next;
              setHandsFreeEnabled(next);
              if (next) {
                startRecognition('Hands-Free');
              } else {
                handsFreeRef.current = false;
                stopRecognition();
              }
            }}
          >
            {handsFreeEnabled ? 'Stop Hands-Free' : 'Talk Freely (Hands-Free)'}
          </button>
          <span className="voice-pill">{voiceStatus}</span>
          <div className="intel-panel">
            <label htmlFor="grace-intelligence">Grace Intelligence</label>
            <select
              id="grace-intelligence"
              value={intelligenceLevel}
              onChange={(event) => setIntelligenceLevel(event.target.value)}
            >
              {Object.entries(intelligenceProfiles).map(([key, profile]) => (
                <option key={key} value={key}>
                  {profile.label}
                </option>
              ))}
            </select>
            <span className="intel-score">Growth Score: {intelligenceScore}</span>
          </div>
        </div>
      </div>
      <div ref={feedRef} className="dispatch-feed-scroll">
        {feedRows}
      </div>
    </section>
  );
}
