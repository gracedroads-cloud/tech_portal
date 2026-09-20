import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import './BreakdownAlertsMonitor.css';

const API_BASE = process.env.REACT_APP_API_BASE || '';
const DEFAULT_CENTER = { label: 'Lehigh Valley Base', lat: 40.6884, lng: -75.2207 };
const DEFAULT_RADIUS = 150;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function distanceMiles(fromLat, fromLng, toLat, toLng) {
  const earthRadiusMiles = 3958.8;
  const latDiff = toRadians(toLat - fromLat);
  const lngDiff = toRadians(toLng - fromLng);
  const a =
    Math.sin(latDiff / 2) * Math.sin(latDiff / 2) +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(lngDiff / 2) * Math.sin(lngDiff / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

function withDistance(alert, center) {
  return {
    ...alert,
    distanceMiles: Number(distanceMiles(center.lat, center.lng, alert.lat, alert.lng).toFixed(1))
  };
}

function incidentKey(alert) {
  return alert.sourceRef || alert.id;
}

export default function BreakdownAlertsMonitor() {
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [radius] = useState(DEFAULT_RADIUS);
  const [alerts, setAlerts] = useState([]);
  const [status, setStatus] = useState('Connecting');
  const containerRef = useRef(null);
  const centerRef = useRef(center);
  const radiusRef = useRef(radius);

  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  useEffect(() => {
    radiusRef.current = radius;
  }, [radius]);

  useEffect(() => {
    let active = true;
    async function loadAlerts(activeCenter) {
      try {
        const response = await fetch(
          `${API_BASE}/api/breakdowns/live?lat=${activeCenter.lat}&lng=${activeCenter.lng}&radius=${radiusRef.current}`
        );
        if (!response.ok) {
          throw new Error(`Breakdown API unavailable: ${response.status}`);
        }
        const data = await response.json();
        if (!active) return;
        setAlerts((data.alerts || []).map((alert) => withDistance(alert, activeCenter)));
      } catch (error) {
        if (active) {
          setStatus('API Unavailable');
        }
      }
    }
    loadAlerts(center);
    return () => {
      active = false;
    };
  }, [center, radius]);

  useEffect(() => {
    const socket = io(API_BASE, { transports: ['websocket'] });
    socket.on('connect', () => setStatus('Live'));
    socket.on('disconnect', () => setStatus('Reconnecting'));
    socket.on('breakdown.alerts', (alert) => {
      const nextAlert = withDistance(alert, centerRef.current);
      if (nextAlert.distanceMiles > radiusRef.current) return;
      setAlerts((current) =>
        [nextAlert, ...current.filter((item) => incidentKey(item) !== incidentKey(nextAlert))].slice(0, 60)
      );
    });
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [alerts]);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setStatus('Geolocation Unsupported');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCenter({
          label: 'Current Location',
          lat: Number(position.coords.latitude.toFixed(5)),
          lng: Number(position.coords.longitude.toFixed(5))
        });
      },
      () => setStatus('Location Permission Needed'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  const rows = useMemo(
    () =>
      alerts.map((alert) => (
        <article className="breakdown-row" key={alert.id}>
          <div className="breakdown-row-top">
            <span className="breakdown-priority">{alert.priority}</span>
            <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
          </div>
          <p className="breakdown-location">{alert.location}</p>
          <p className="breakdown-cause">{alert.vehicle} — {alert.cause}</p>
          <p className="breakdown-source">Source: {alert.source || 'dispatch_console'} {alert.sourceRef ? `(${alert.sourceRef})` : ''}</p>
          <p className="breakdown-distance">{alert.distanceMiles} mi from monitor center</p>
        </article>
      )),
    [alerts]
  );

  return (
    <section className="breakdown-panel">
      <div className="breakdown-header">
        <div>
          <h2>Breakdown Alerts (150 mi)</h2>
          <p>{center.label}: {center.lat}, {center.lng}</p>
          <p>Includes all breakdown sources: dispatch, DVIR, telematics, and manual intake.</p>
        </div>
        <div className="breakdown-actions">
          <span className="breakdown-status">{status}</span>
          <button type="button" onClick={useCurrentLocation}>Use My Location</button>
        </div>
      </div>
      <div className="breakdown-feed" ref={containerRef}>
        {rows.length ? rows : <p className="breakdown-empty">No active alerts in radius.</p>}
      </div>
    </section>
  );
}
