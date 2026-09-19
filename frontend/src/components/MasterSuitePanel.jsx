import { useEffect, useState } from 'react';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:3000';

export default function MasterSuitePanel({ role }) {
  const [contracts, setContracts] = useState(null);
  const [flags, setFlags] = useState(null);
  const [observability, setObservability] = useState(null);
  const [kpis, setKpis] = useState(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [contractsRes, flagsRes, observabilityRes, kpisRes] = await Promise.all([
          fetch(`${API_BASE}/api/mastersuite/contracts`),
          fetch(`${API_BASE}/api/mastersuite/feature-flags`),
          fetch(`${API_BASE}/api/mastersuite/observability`),
          fetch(`${API_BASE}/api/mastersuite/kpis`)
        ]);
        const [contractsData, flagsData, observabilityData, kpisData] = await Promise.all([
          contractsRes.json(),
          flagsRes.json(),
          observabilityRes.json(),
          kpisRes.json()
        ]);
        if (!active) return;
        setContracts(contractsData);
        setFlags(flagsData);
        setObservability(observabilityData);
        setKpis(kpisData);
      } catch (error) {
        if (!active) return;
        setContracts({ error: 'Unavailable' });
      }
    }
    load();
    const timer = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const roleDomains = contracts?.roleBoundaries?.[role] || [];
  const rolloutStage = flags?.stagedRollout?.[0]?.stage || 'pilot';

  return (
    <section className="suite-panel">
      <div className="suite-header">
        <h2>MasterSuite Governance</h2>
        <span className="suite-pill">Stage: {rolloutStage}</span>
      </div>

      <div className="suite-grid">
        <article className="suite-card">
          <h3>Role Boundary</h3>
          <p>{role.toUpperCase()} domains: {roleDomains.join(', ') || 'N/A'}</p>
        </article>
        <article className="suite-card">
          <h3>SLO Targets</h3>
          <p>API P95: {observability?.slos?.apiLatencyP95Ms ?? '--'} ms</p>
          <p>Event P95: {observability?.slos?.eventDeliveryP95Ms ?? '--'} ms</p>
        </article>
        <article className="suite-card">
          <h3>KPI Snapshot</h3>
          <p>Mean response: {kpis?.meanResponseMinutes ?? '--'} min</p>
          <p>Ack P95: {kpis?.alertAckSecondsP95 ?? '--'} sec</p>
        </article>
        <article className="suite-card">
          <h3>Feature Flags</h3>
          <p>Enabled: {Object.values(flags?.flags || {}).filter(Boolean).length}</p>
          <p>Total: {Object.keys(flags?.flags || {}).length}</p>
        </article>
      </div>
    </section>
  );
}
