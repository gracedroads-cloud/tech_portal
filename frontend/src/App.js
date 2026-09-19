import './App.css';
import { useState } from 'react';
import DispatchFeed from './components/DispatchFeed';
import MasterSuitePanel from './components/MasterSuitePanel';

const rolePanels = {
  operator: ['dispatch', 'fleet', 'health', 'alerts'],
  hr: ['hr', 'alerts'],
  admin: ['dispatch', 'fleet', 'hr', 'health', 'alerts', 'video', 'ai']
};

const panelLabels = {
  fleet: 'Fleet Telemetry',
  hr: 'HR & Payroll Activity',
  health: 'System Health',
  alerts: 'Unified Alerts',
  video: 'Live Video Feeds',
  ai: 'Grace AI Insights'
};

const panelStatus = {
  fleet: { tone: 'status-info', text: 'Staged' },
  hr: { tone: 'status-warning', text: 'Governed' },
  health: { tone: 'status-good', text: 'Monitored' },
  alerts: { tone: 'status-critical', text: 'Priority' },
  video: { tone: 'status-info', text: 'Pending' },
  ai: { tone: 'status-warning', text: 'Approval Gate' }
};

function App() {
  const [role, setRole] = useState('operator');

  const visiblePanels = rolePanels[role] || rolePanels.operator;

  return (
    <div className="command-center">
      <header className="command-center-header">
        <div>
          <h1>Grace Command Center</h1>
          <p>Realtime operations cockpit</p>
        </div>
        <label className="role-selector">
          Role View
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="operator">Operator</option>
            <option value="hr">HR</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </header>

      <main className="monitor-wall">
        <section className="tile tile-suite">
          <MasterSuitePanel role={role} />
        </section>
        {visiblePanels.includes('dispatch') && (
          <div className="tile tile-dispatch">
            <DispatchFeed />
          </div>
        )}
        {visiblePanels
          .filter((panel) => panel !== 'dispatch')
          .map((panel) => (
            <section key={panel} className="tile tile-placeholder">
              <div className="tile-header">
                <h2>{panelLabels[panel]}</h2>
                <span className={`tile-badge ${panelStatus[panel]?.tone || 'status-info'}`}>
                  {panelStatus[panel]?.text || 'Staged'}
                </span>
              </div>
              <p>Live panel staged for migration.</p>
            </section>
          ))}
      </main>
    </div>
  );
}

export default App;
