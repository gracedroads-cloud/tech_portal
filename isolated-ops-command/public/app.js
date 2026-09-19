const state = {
  config: null,
  snapshot: null,
  mediaMute: {}
};

const monitorGrid = document.getElementById('monitorGrid');
const mediaGrid = document.getElementById('mediaGrid');
const incidentFeed = document.getElementById('incidentFeed');
const dispatchQueue = document.getElementById('dispatchQueue');
const policyRejections = document.getElementById('policyRejections');
const auditFeed = document.getElementById('auditFeed');
const messageBar = document.getElementById('messageBar');
const simulationBanner = document.getElementById('simulationBanner');
const tokenInput = document.getElementById('tokenInput');
const secureSessions = document.getElementById('secureSessions');
const automationState = document.getElementById('automationState');
const lastUpdated = document.getElementById('lastUpdated');

function getToken() {
  return tokenInput.value.trim();
}

function setMessage(message) {
  messageBar.textContent = message;
}

function headers() {
  const token = getToken();
  return {
    'content-type': 'application/json',
    'x-ops-token': token
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...headers()
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
}

function statusBadge(status) {
  return `<span class="status-badge">${status}</span>`;
}

function renderSnapshot(snapshot) {
  state.snapshot = snapshot;
  simulationBanner.hidden = !snapshot.simulationMode;
  lastUpdated.textContent = `Updated ${new Date(snapshot.lastUpdatedAt).toLocaleTimeString()}`;
  automationState.textContent = snapshot.automationPaused ? `Paused: ${snapshot.automationPauseReason || 'manual hold'}` : 'Automation active (human approval still required by default)';
  automationState.className = `state-pill ${snapshot.automationPaused ? 'state-danger' : ''}`;

  monitorGrid.innerHTML = Object.entries(snapshot.monitors)
    .map(([key, monitor]) => `
      <article class="monitor-card" data-status="${monitor.status}">
        <div class="panel-title-row">
          <strong>${monitor.label}</strong>
          ${statusBadge(monitor.status)}
        </div>
        <p>${monitor.detail}</p>
        <p class="meta">${key} • ${new Date(monitor.lastUpdatedAt).toLocaleString()}</p>
      </article>
    `).join('');

  incidentFeed.innerHTML = snapshot.incidents.length ? snapshot.incidents.slice().reverse().map((incident) => `
    <div class="feed-item">
      <strong>${incident.customer}</strong>
      <div>${incident.description}</div>
      <div class="meta">${incident.status} • ${incident.serviceType} • ${new Date(incident.createdAt).toLocaleString()}</div>
    </div>
  `).join('') : '<div class="feed-item">No incidents yet.</div>';

  dispatchQueue.innerHTML = snapshot.dispatchQueue.length ? snapshot.dispatchQueue.slice().reverse().map((item) => `
    <div class="queue-card">
      <div class="panel-title-row">
        <strong>${item.recommendedServiceType}</strong>
        ${statusBadge(item.status)}
      </div>
      <div>${item.description}</div>
      <div class="meta">Priority ${item.priority} • Human approval ${item.requiresHumanApproval ? 'required' : 'not required'}</div>
      ${item.status === 'awaiting_human_approval' ? `<button data-approve="${item.id}" type="button">Approve Dispatch</button>` : ''}
    </div>
  `).join('') : '<div class="feed-item">No queue items.</div>';

  policyRejections.innerHTML = snapshot.policyRejections.length ? snapshot.policyRejections.slice().reverse().map((item) => `
    <div class="feed-item">
      <strong>${item.incidentId}</strong>
      <div>${item.rejection.message}</div>
      <div class="meta">Referral: ${item.routedTo} • ${new Date(item.at).toLocaleString()}</div>
    </div>
  `).join('') : '<div class="feed-item">No policy rejections recorded.</div>';

  auditFeed.innerHTML = snapshot.auditTail.length ? snapshot.auditTail.slice().reverse().map((event) => `
    <div class="feed-item">
      <strong>${event.type}</strong>
      <div class="meta">${new Date(event.at).toLocaleString()}</div>
      <pre>${JSON.stringify(event.detail, null, 2)}</pre>
    </div>
  `).join('') : '<div class="feed-item">No audit events yet.</div>';

  secureSessions.innerHTML = snapshot.secureBrowserSessions.length ? snapshot.secureBrowserSessions.map((session) => {
    const iframe = session.mode === 'iframe'
      ? `<div class="media-preview"><iframe sandbox="allow-forms allow-scripts allow-same-origin" src="${session.url}" data-fallback-url="${session.url}" title="Secure session ${session.hostname}"></iframe></div>`
      : '<div class="media-preview">Destination opened in protected tab or window. Embedding may be blocked by policy headers.</div>';
    return `
      <div class="session-card">
        <strong>${session.hostname}</strong>
        <div class="meta">${session.origin} • expires ${new Date(session.expiresAt).toLocaleTimeString()}</div>
        ${iframe}
        <div class="session-actions">
          <button class="secondary" type="button" data-open-session="${session.url}">Open protected tab</button>
        </div>
      </div>
    `;
  }).join('') : '<div class="feed-item">No secure browser sessions.</div>';

  mediaGrid.innerHTML = snapshot.mediaSources.length ? snapshot.mediaSources.map((source) => {
    const sourceKey = `${source.kind}-${source.id}`;
    const muted = state.mediaMute[sourceKey] !== false;
    const status = `${source.simulated ? 'SIMULATED' : source.state.toUpperCase()}`;
    const preview = source.simulated || !source.url
      ? `<div class="media-preview">${source.kind.toUpperCase()} ${status}<br>${source.name}</div>`
      : source.type === 'EMBED'
        ? `<div class="media-preview"><iframe sandbox="allow-scripts allow-same-origin" src="${source.url}" title="${source.name}"></iframe></div>`
        : `<div class="media-preview">Authorized ${source.type} source configured for operator-managed playback.<br>${source.url}</div>`;
    return `
      <article class="media-card" data-status="${source.state}">
        <div class="panel-title-row">
          <strong>${source.name}</strong>
          ${statusBadge(source.state)}
        </div>
        <div class="meta">${source.kind} • ${source.type} • ${new Date(source.lastUpdatedAt).toLocaleString()}</div>
        ${source.error ? `<p class="state-danger">${source.error}</p>` : ''}
        ${preview}
        <div class="media-actions">
          <button class="secondary" type="button" data-mute="${sourceKey}">${muted ? 'Unmute' : 'Mute'}</button>
          <button class="secondary" type="button" data-reconnect="${source.id}">Reconnect</button>
          ${source.url ? `<button class="secondary" type="button" data-open-source="${source.url}">Open Source</button>` : ''}
        </div>
      </article>
    `;
  }).join('') : '<div class="feed-item">No media sources registered.</div>';
}

async function refresh() {
  const [config, snapshot] = await Promise.all([api('/api/config', { method: 'GET' }), api('/api/state', { method: 'GET' })]);
  state.config = config;
  const serviceType = document.getElementById('serviceType');
  serviceType.innerHTML = config.supportedServices.map((service) => `<option value="${service}">${service.replace(/_/g, ' ')}</option>`).join('');
  renderSnapshot(snapshot);
}

function connectEvents() {
  const stream = new EventSource('/api/events');
  stream.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.payload && data.payload.state) {
      renderSnapshot(data.payload.state);
      return;
    }
    if (data.payload && data.payload.monitors) {
      renderSnapshot(data.payload);
    }
  };
  stream.addEventListener('snapshot', (event) => {
    const data = JSON.parse(event.data);
    renderSnapshot(data.payload);
  });
  stream.onerror = () => setMessage('Live event stream interrupted; retrying automatically.');
}

function preventUnsupportedService(description) {
  return /(tow|winch|recovery|pull\s*out)/i.test(description);
}

document.getElementById('incidentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  if (preventUnsupportedService(`${payload.serviceType} ${payload.description}`)) {
    setMessage('Rejected locally: NO TOWING and NO WINCHING. Route this request to an approved external provider.');
    return;
  }
  try {
    const result = await api('/api/incidents', { method: 'POST', body: JSON.stringify(payload) });
    setMessage(`Incident triaged: ${result.queueItem.status}. Human approval remains required unless low-risk auto-dispatch is explicitly enabled.`);
  } catch (error) {
    setMessage(error.message);
  }
});

document.getElementById('pauseForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api('/api/automation/pause', {
      method: 'POST',
      body: JSON.stringify({ paused: !(state.snapshot?.automationPaused), reason: form.get('reason') })
    });
    setMessage(result.paused ? 'Automation paused.' : 'Automation resumed.');
  } catch (error) {
    setMessage(error.message);
  }
});

document.getElementById('simulateButton').addEventListener('click', async () => {
  try {
    await api('/api/simulate/tick', { method: 'POST', body: '{}' });
    setMessage('Generated a simulation event.');
  } catch (error) {
    setMessage(error.message);
  }
});

document.getElementById('browserForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api('/api/secure-browser/launch', { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) });
    setMessage('Secure browser session launched.');
  } catch (error) {
    setMessage(error.message);
  }
});

document.getElementById('clearSessionsButton').addEventListener('click', async () => {
  try {
    await api('/api/secure-browser/clear', { method: 'POST', body: '{}' });
    setMessage('Secure browser sessions cleared.');
  } catch (error) {
    setMessage(error.message);
  }
});

document.getElementById('mediaForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  payload.simulated = form.get('simulated') === 'on';
  if (payload.simulated) {
    payload.url = '';
  }
  try {
    await api('/api/media/sources', { method: 'POST', body: JSON.stringify(payload) });
    setMessage('Media source registered.');
  } catch (error) {
    setMessage(error.message);
  }
});

document.addEventListener('click', async (event) => {
  const approveId = event.target.getAttribute('data-approve');
  const sourceUrl = event.target.getAttribute('data-open-source');
  const sessionUrl = event.target.getAttribute('data-open-session');
  const muteId = event.target.getAttribute('data-mute');
  const reconnectId = event.target.getAttribute('data-reconnect');

  if (approveId) {
    try {
      await api(`/api/dispatch/${approveId}/approve`, { method: 'POST', body: JSON.stringify({ operator: 'Local Operator' }) });
      setMessage('Dispatch approved.');
    } catch (error) {
      setMessage(error.message);
    }
  }

  if (sourceUrl || sessionUrl) {
    window.open(sourceUrl || sessionUrl, '_blank', 'noopener,noreferrer');
  }

  if (muteId) {
    state.mediaMute[muteId] = !state.mediaMute[muteId];
    renderSnapshot(state.snapshot);
  }

  if (reconnectId) {
    setMessage(`Reconnect requested for media source ${reconnectId}. Check source health and browser autoplay policy.`);
  }
});

document.getElementById('fullscreenButton').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    setMessage(error.message);
  }
});

tokenInput.value = localStorage.getItem('isolatedOpsToken') || '';
tokenInput.addEventListener('change', () => localStorage.setItem('isolatedOpsToken', tokenInput.value));

refresh().then(connectEvents).catch((error) => setMessage(error.message));
