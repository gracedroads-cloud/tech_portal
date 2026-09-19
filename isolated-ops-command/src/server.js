const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const {
  LOW_RISK_AUTO_DISPATCH_SERVICES,
  POLICY_LABEL,
  SUPPORTED_SERVICES,
  applyPolicyToAiOutput,
  evaluatePolicy,
  normalizeServiceType,
  sanitizeRecommendedService
} = require('./policy');
const { createStorage } = require('./storage');
const { createGraceAiAdapter } = require('./grace-ai');
const { createTeamsAdapter } = require('./teams');

const MONITOR_KEYS = [
  'systemHealth',
  'incidentFeed',
  'dispatchQueue',
  'activeUnits',
  'graceAiActivity',
  'communicationsTeams',
  'videoSources',
  'liveTvSources',
  'secureBrowserSessions',
  'policyRejections',
  'auditEvents'
];

function now() {
  return new Date().toISOString();
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonList(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function loadConfig(overrides = {}) {
  const rootDir = path.resolve(__dirname, '..');
  const dataDir = overrides.dataDir || process.env.ISOLATED_OPS_DATA_DIR || path.join(rootDir, 'data');
  const allowedCorsOrigins = overrides.allowedCorsOrigins || splitCsv(process.env.ISOLATED_OPS_ALLOWED_ORIGINS);
  const mediaAllowlist = overrides.mediaAllowlist || splitCsv(process.env.ISOLATED_OPS_MEDIA_ALLOWLIST);
  const secureBrowserAllowlist = overrides.secureBrowserAllowlist || splitCsv(process.env.ISOLATED_OPS_SECURE_BROWSER_ALLOWLIST);
  const cspFrameSources = overrides.cspFrameSources || splitCsv(process.env.ISOLATED_OPS_CSP_FRAME_SRC || process.env.ISOLATED_OPS_MEDIA_ALLOWLIST);
  const cspMediaSources = overrides.cspMediaSources || splitCsv(process.env.ISOLATED_OPS_CSP_MEDIA_SRC || process.env.ISOLATED_OPS_MEDIA_ALLOWLIST);
  return {
    appLabel: 'EH Graced Roads Solutions LLC — Isolated Operations Command',
    auditTailLimit: Number(overrides.auditTailLimit ?? process.env.ISOLATED_OPS_AUDIT_TAIL_LIMIT ?? 25),
    autoDispatchEnabled: parseBoolean(overrides.autoDispatchEnabled ?? process.env.ISOLATED_OPS_ENABLE_AUTO_DISPATCH, false),
    allowedCorsOrigins,
    cspFrameSources,
    cspMediaSources,
    dataDir,
    graceAiApiKey: overrides.graceAiApiKey || process.env.GRACE_AI_API_KEY || '',
    graceAiEndpoint: overrides.graceAiEndpoint || process.env.GRACE_AI_ENDPOINT || '',
    inboundTeamsToken: overrides.inboundTeamsToken || process.env.TEAMS_INBOUND_TOKEN || '',
    maxBodyBytes: Number(overrides.maxBodyBytes ?? process.env.ISOLATED_OPS_MAX_BODY_BYTES ?? 16384),
    mediaAllowlist,
    opsToken: overrides.opsToken || process.env.ISOLATED_OPS_TOKEN || 'change-me-isolated-ops',
    outboundTimeoutMs: Number(overrides.outboundTimeoutMs ?? process.env.ISOLATED_OPS_TIMEOUT_MS ?? 3000),
    port: Number(overrides.port ?? process.env.ISOLATED_OPS_PORT ?? 4300),
    secureBrowserAllowlist,
    secureBrowserSessionMinutes: Number(overrides.secureBrowserSessionMinutes ?? process.env.ISOLATED_OPS_BROWSER_SESSION_MINUTES ?? 20),
    simulationMode: parseBoolean(overrides.simulationMode ?? process.env.ISOLATED_OPS_SIMULATION_MODE, true),
    teamsBackoffMs: Number(overrides.teamsBackoffMs ?? process.env.TEAMS_BACKOFF_MS ?? 250),
    teamsRetries: Number(overrides.teamsRetries ?? process.env.TEAMS_RETRIES ?? 2),
    teamsWebhookUrl: overrides.teamsWebhookUrl || process.env.TEAMS_WEBHOOK_URL || '',
    tvRegistry: overrides.tvRegistry || parseJsonList(process.env.ISOLATED_OPS_TV_REGISTRY, []),
    videoRegistry: overrides.videoRegistry || parseJsonList(process.env.ISOLATED_OPS_VIDEO_REGISTRY, [])
  };
}

function createInitialState(config, storage) {
  const stamp = now();
  const baseState = {
    label: config.appLabel,
    simulationMode: config.simulationMode,
    automationPaused: false,
    automationPauseReason: '',
    lastUpdatedAt: stamp,
    incidents: [],
    dispatchQueue: [],
    activeUnits: [
      {
        id: 'unit-201',
        name: 'Mobile Service Van #201',
        capabilities: SUPPORTED_SERVICES,
        status: config.simulationMode ? 'simulated' : 'online',
        lastUpdatedAt: stamp
      }
    ],
    policyRejections: [],
    auditTail: storage.readAudit(config.auditTailLimit),
    mediaSources: [
      ...config.videoRegistry,
      ...config.tvRegistry
    ].map((source, index) => ({
      id: source.id || `media-${index + 1}`,
      kind: source.kind || (index < config.videoRegistry.length ? 'video' : 'tv'),
      name: source.name || `Source ${index + 1}`,
      type: source.type || 'EMBED',
      url: source.url || '',
      state: source.state || 'offline',
      simulated: Boolean(source.simulated),
      lastUpdatedAt: stamp,
      error: source.error || null
    })),
    secureBrowserSessions: [],
    idempotencyKeys: {},
    teamsEvents: [],
    lastGraceAiDecision: null,
    monitors: {}
  };

  const persisted = storage.loadState(baseState);
  return refreshMonitors({ ...baseState, ...persisted, auditTail: storage.readAudit(config.auditTailLimit) }, config, null);
}

function refreshMonitors(state, config, teamsHealth) {
  const stamp = now();
  const mediaVideo = state.mediaSources.filter((source) => source.kind === 'video');
  const mediaTv = state.mediaSources.filter((source) => source.kind === 'tv');
  const hasRecentAudit = state.auditTail.length > 0;

  state.monitors = {
    systemHealth: { status: 'online', label: 'System Health', detail: state.automationPaused ? 'Automation paused' : 'Ready', lastUpdatedAt: stamp },
    incidentFeed: { status: state.incidents.length ? 'online' : config.simulationMode ? 'simulated' : 'stale', label: 'Incident Feed', detail: `${state.incidents.length} tracked`, lastUpdatedAt: stamp },
    dispatchQueue: { status: state.dispatchQueue.length ? 'online' : 'stale', label: 'Dispatch Queue', detail: `${state.dispatchQueue.length} items awaiting action`, lastUpdatedAt: stamp },
    activeUnits: { status: state.activeUnits.some((unit) => unit.status === 'online') ? 'online' : config.simulationMode ? 'simulated' : 'offline', label: 'Active Units', detail: `${state.activeUnits.length} units visible`, lastUpdatedAt: stamp },
    graceAiActivity: { status: state.lastGraceAiDecision ? (state.lastGraceAiDecision.provider === 'simulation' ? 'simulated' : 'online') : 'stale', label: 'Grace AI Activity', detail: state.lastGraceAiDecision ? state.lastGraceAiDecision.summary : 'No decisions yet', lastUpdatedAt: stamp },
    communicationsTeams: { status: teamsHealth?.lastError ? 'error' : (teamsHealth?.mode === 'simulation' ? 'simulated' : teamsHealth?.lastSuccessAt ? 'online' : 'stale'), label: 'Communications / Teams', detail: teamsHealth?.lastError || teamsHealth?.mode || 'Not configured', lastUpdatedAt: stamp },
    videoSources: { status: mediaVideo.length ? (mediaVideo.some((source) => source.state === 'error') ? 'error' : mediaVideo.some((source) => source.state === 'online') ? 'online' : 'simulated') : 'stale', label: 'Video Sources', detail: `${mediaVideo.length} registered`, lastUpdatedAt: stamp },
    liveTvSources: { status: mediaTv.length ? (mediaTv.some((source) => source.state === 'error') ? 'error' : mediaTv.some((source) => source.state === 'online') ? 'online' : 'simulated') : 'stale', label: 'Live TV / News', detail: `${mediaTv.length} registered`, lastUpdatedAt: stamp },
    secureBrowserSessions: { status: state.secureBrowserSessions.length ? 'online' : 'stale', label: 'Secure Browser Sessions', detail: `${state.secureBrowserSessions.length} active`, lastUpdatedAt: stamp },
    policyRejections: { status: state.policyRejections.length ? 'online' : 'stale', label: 'Policy Rejections', detail: `${state.policyRejections.length} recorded`, lastUpdatedAt: stamp },
    auditEvents: { status: hasRecentAudit ? 'online' : 'stale', label: 'Audit Events', detail: `${state.auditTail.length} recent events`, lastUpdatedAt: stamp }
  };
  state.lastUpdatedAt = stamp;
  return state;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function createRateLimiter(limit, windowMs) {
  const buckets = new Map();
  return {
    check(key) {
      const stamp = Date.now();
      const bucket = buckets.get(key) || [];
      const filtered = bucket.filter((entry) => stamp - entry < windowMs);
      if (filtered.length >= limit) {
        buckets.set(key, filtered);
        return false;
      }
      filtered.push(stamp);
      buckets.set(key, filtered);
      return true;
    }
  };
}

function parseBody(req, res, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) {
        return;
      }
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        if (!res.headersSent) {
          toJson(res, 413, { error: 'Payload too large' });
        }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        resolve(null);
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(Object.assign(new Error('Malformed JSON payload'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function redact(obj) {
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    if (typeof value === 'string' && /(token|secret|authorization|password|apiKey)/i.test(key)) {
      return '[REDACTED]';
    }
    if (typeof value === 'string' && value.length > 400) {
      return `${value.slice(0, 397)}...`;
    }
    return value;
  }));
}

function readStaticFile(filePath) {
  return fs.readFileSync(filePath);
}

function toJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function createCsp(config) {
  const frameSources = ["'self'", ...config.cspFrameSources];
  const mediaSources = ["'self'", 'blob:', 'data:', ...config.cspMediaSources];
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self'`,
    `frame-src ${frameSources.join(' ')}`,
    `media-src ${mediaSources.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'"
  ].join('; ');
}

function validateAuth(req, config) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-ops-token'];
  return token === config.opsToken;
}

function validateIncident(body = {}) {
  const description = String(body.description || '').trim();
  const requestedService = String(body.serviceType || '').trim();
  const serviceType = requestedService ? normalizeServiceType(requestedService) : 'mobile_diagnostics';
  if (!description) {
    return { error: 'description is required' };
  }
  return {
    incidentId: String(body.incidentId || randomUUID()),
    description,
    source: String(body.source || 'manual').slice(0, 80),
    origin: String(body.origin || 'operations-center').slice(0, 120),
    requestedService,
    serviceType: sanitizeRecommendedService(serviceType),
    customer: String(body.customer || 'Unknown customer').slice(0, 120)
  };
}

function validateMediaSource(body = {}, config) {
  const source = {
    id: String(body.id || randomUUID()),
    kind: body.kind === 'tv' ? 'tv' : 'video',
    name: String(body.name || '').trim(),
    type: String(body.type || '').toUpperCase(),
    url: String(body.url || '').trim(),
    simulated: Boolean(body.simulated),
    state: String(body.state || (body.simulated ? 'simulated' : 'offline')).toLowerCase()
  };

  if (!source.name) {
    return { error: 'name is required' };
  }
  if (!['HLS', 'DASH', 'WEBRTC', 'EMBED'].includes(source.type)) {
    return { error: 'type must be one of HLS, DASH, WEBRTC, EMBED' };
  }
  if (!source.simulated) {
    try {
      const parsed = new URL(source.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { error: 'media source protocol must be http or https' };
      }
      if (config.mediaAllowlist.length && !config.mediaAllowlist.includes(parsed.origin)) {
        return { error: 'media source origin is not allowlisted' };
      }
    } catch (error) {
      return { error: 'url must be a valid absolute URL or mark the source simulated' };
    }
  }

  return { ...source, lastUpdatedAt: now(), error: null };
}

function validateSecureBrowserTarget(body = {}, config) {
  const url = String(body.url || '').trim();
  if (!url) {
    return { error: 'url is required' };
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { error: 'only http and https URLs are allowed' };
    }
    if (config.secureBrowserAllowlist.length && !config.secureBrowserAllowlist.includes(parsed.origin)) {
      return { error: 'target origin is not allowlisted' };
    }
    return {
      id: randomUUID(),
      url: parsed.toString(),
      origin: parsed.origin,
      hostname: parsed.hostname,
      mode: body.mode === 'iframe' ? 'iframe' : 'external_window',
      state: 'pending',
      launchedAt: now(),
      expiresAt: new Date(Date.now() + config.secureBrowserSessionMinutes * 60_000).toISOString()
    };
  } catch (error) {
    return { error: 'url must be a valid absolute URL' };
  }
}

function createServer(overrides = {}) {
  const config = loadConfig(overrides);
  const storage = createStorage(config.dataDir);
  const eventBus = new EventEmitter();
  const logger = (level, event, meta = {}) => {
    const line = JSON.stringify({ level, event, at: now(), ...redact(meta) });
    if (overrides.silent !== true) {
      process.stdout.write(`${line}\n`);
    }
  };
  const graceAi = createGraceAiAdapter(config, logger);
  const teams = createTeamsAdapter(config, logger);
  const rateLimiter = createRateLimiter(60, 60_000);
  const staticDir = path.resolve(__dirname, '..', 'public');
  const assets = {
    '/': { file: path.join(staticDir, 'index.html'), contentType: 'text/html; charset=utf-8' },
    '/index.html': { file: path.join(staticDir, 'index.html'), contentType: 'text/html; charset=utf-8' },
    '/app.js': { file: path.join(staticDir, 'app.js'), contentType: 'application/javascript; charset=utf-8' },
    '/styles.css': { file: path.join(staticDir, 'styles.css'), contentType: 'text/css; charset=utf-8' }
  };

  let state = createInitialState(config, storage);
  let simulationInterval = null;
  const sseClients = new Set();

  function persist() {
    state = refreshMonitors(state, config, teams.getHealth());
    storage.saveState(state);
  }

  function audit(type, detail = {}) {
    const event = { id: randomUUID(), type, at: now(), detail: redact(detail) };
    storage.appendAudit(event);
    state.auditTail = storage.readAudit(config.auditTailLimit);
    state = refreshMonitors(state, config, teams.getHealth());
    emit('audit', event);
    return event;
  }

  function emit(type, payload) {
    const message = { type, at: now(), payload };
    eventBus.emit('event', message);
    for (const res of sseClients) {
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    }
  }

  function updateState(mutator, eventType) {
    mutator(state);
    persist();
    if (eventType) {
      emit(eventType, { state: getPublicState() });
    }
  }

  function getPublicState() {
    return {
      label: state.label,
      simulationMode: state.simulationMode,
      automationPaused: state.automationPaused,
      automationPauseReason: state.automationPauseReason,
      lastUpdatedAt: state.lastUpdatedAt,
      monitors: state.monitors,
      incidents: state.incidents.slice(-10),
      dispatchQueue: state.dispatchQueue.slice(-10),
      activeUnits: state.activeUnits,
      policyRejections: state.policyRejections.slice(-10),
      auditTail: state.auditTail,
      mediaSources: state.mediaSources,
      secureBrowserSessions: state.secureBrowserSessions,
      teamsHealth: teams.getHealth(),
      lastGraceAiDecision: state.lastGraceAiDecision,
      supportedServices: SUPPORTED_SERVICES,
      policyLabel: POLICY_LABEL
    };
  }

  async function handleIncident(req, res, body) {
    const validated = validateIncident(body);
    if (validated.error) {
      toJson(res, 400, { error: validated.error });
      return;
    }

    const idempotencyKey = String(req.headers['idempotency-key'] || validated.incidentId);
    if (state.idempotencyKeys[idempotencyKey]) {
      toJson(res, 200, { duplicate: true, incident: state.idempotencyKeys[idempotencyKey] });
      return;
    }

    const policyRejection = evaluatePolicy(validated);
    if (policyRejection) {
      const rejection = {
        id: randomUUID(),
        incidentId: validated.incidentId,
        serviceType: body.serviceType,
        description: validated.description,
        at: now(),
        rejection: policyRejection,
        routedTo: policyRejection.referralProvider
      };
      updateState((draft) => {
        draft.policyRejections.push(rejection);
        draft.incidents.push({ ...validated, status: 'policy_rejected', createdAt: now() });
        draft.idempotencyKeys[idempotencyKey] = rejection;
      }, 'policy_rejection');
      audit('policy.rejected', rejection);
      await teams.postStatusSummary({ text: `Policy rejection logged for incident ${validated.incidentId}. External referral required.` });
      toJson(res, 422, { error: policyRejection.message, rejection });
      return;
    }

    let decision;
    try {
      decision = applyPolicyToAiOutput(await graceAi.classifyIncident(validated));
    } catch (error) {
      decision = applyPolicyToAiOutput({
        provider: 'fallback',
        summary: 'Grace AI unavailable. Defaulting to mobile diagnostics triage.',
        recommendedServiceType: validated.serviceType,
        requiresHumanApproval: true,
        allowedActions: ['draft_dispatch'],
        flags: ['grace_ai_unavailable']
      });
      audit('grace_ai.error', { message: error.message });
    }

    if (decision.policyRejected) {
      const rejection = {
        id: randomUUID(),
        incidentId: validated.incidentId,
        description: validated.description,
        at: now(),
        rejection: decision.rejection,
        routedTo: decision.rejection.referralProvider
      };
      updateState((draft) => {
        draft.policyRejections.push(rejection);
        draft.incidents.push({ ...validated, status: 'policy_rejected', createdAt: now() });
        draft.lastGraceAiDecision = decision;
        draft.idempotencyKeys[idempotencyKey] = rejection;
      }, 'policy_rejection');
      audit('policy.rejected_ai_output', rejection);
      toJson(res, 422, { error: decision.rejection.message, rejection });
      return;
    }

    const queueItem = {
      id: randomUUID(),
      incidentId: validated.incidentId,
      description: validated.description,
      customer: validated.customer,
      origin: validated.origin,
      source: validated.source,
      recommendedServiceType: decision.recommendedServiceType,
      priority: decision.priority,
      createdAt: now(),
      requiresHumanApproval: true,
      status: 'awaiting_human_approval',
      aiSummary: decision.summary
    };

    const canAutoDispatch = config.autoDispatchEnabled
      && !state.automationPaused
      && LOW_RISK_AUTO_DISPATCH_SERVICES.includes(queueItem.recommendedServiceType)
      && decision.requiresHumanApproval === false;

    if (canAutoDispatch) {
      queueItem.requiresHumanApproval = false;
      queueItem.status = 'auto_dispatched';
      queueItem.dispatchedAt = now();
    }

    updateState((draft) => {
      draft.lastGraceAiDecision = decision;
      draft.incidents.push({ ...validated, status: queueItem.status, createdAt: now() });
      draft.dispatchQueue.push(queueItem);
      draft.idempotencyKeys[idempotencyKey] = queueItem;
    }, 'incident_updated');
    audit(canAutoDispatch ? 'dispatch.auto_dispatched' : 'dispatch.recommendation_created', { incidentId: validated.incidentId, queueItemId: queueItem.id });
    await teams.postStatusSummary({ text: `Incident ${validated.incidentId} triaged for ${queueItem.recommendedServiceType.replace(/_/g, ' ')}.` });
    toJson(res, 202, { incident: validated, queueItem, decision, automationPaused: state.automationPaused });
  }

  function handleApprove(res, body, queueId) {
    const operator = String(body.operator || '').trim();
    if (!operator) {
      toJson(res, 400, { error: 'operator is required' });
      return;
    }
    const item = state.dispatchQueue.find((entry) => entry.id === queueId);
    if (!item) {
      toJson(res, 404, { error: 'queue item not found' });
      return;
    }
    if (item.status === 'policy_rejected') {
      toJson(res, 409, { error: 'policy rejected items cannot be approved' });
      return;
    }
    updateState((draft) => {
      const target = draft.dispatchQueue.find((entry) => entry.id === queueId);
      target.status = 'approved_dispatch';
      target.approvedBy = operator;
      target.approvedAt = now();
      target.requiresHumanApproval = false;
    }, 'dispatch_updated');
    audit('dispatch.approved', { queueItemId: queueId, operator });
    toJson(res, 200, { approved: true, queueItemId: queueId, operator });
  }

  function handleAutomationPause(res, body) {
    const paused = Boolean(body.paused);
    updateState((draft) => {
      draft.automationPaused = paused;
      draft.automationPauseReason = paused ? String(body.reason || 'Manual operator pause') : '';
    }, 'automation_updated');
    audit(paused ? 'automation.paused' : 'automation.resumed', { reason: state.automationPauseReason });
    toJson(res, 200, { paused: state.automationPaused, reason: state.automationPauseReason });
  }

  async function handleTeamsNotify(res, body) {
    const summary = String(body.summary || '').trim();
    if (!summary) {
      toJson(res, 400, { error: 'summary is required' });
      return;
    }
    const result = await teams.postStatusSummary({ text: summary });
    audit('teams.notification', { mode: result.mode });
    updateState(() => {}, 'teams_updated');
    toJson(res, 200, { ok: true, result });
  }

  function handleInboundTeams(req, res, body) {
    if (!config.inboundTeamsToken) {
      toJson(res, 503, { error: 'Teams inbound integration is not configured' });
      return;
    }
    const bearer = req.headers.authorization || '';
    if (bearer !== ['Bearer', config.inboundTeamsToken].join(' ')) {
      toJson(res, 401, { error: 'Unauthorized Teams event' });
      return;
    }
    const normalizedEvent = {
      id: randomUUID(),
      source: 'teams',
      eventType: String(body.eventType || 'unknown').slice(0, 80),
      summary: String(body.summary || '').slice(0, 200),
      at: now()
    };
    updateState((draft) => {
      draft.teamsEvents.push(normalizedEvent);
    }, 'teams_updated');
    audit('teams.event.received', normalizedEvent);
    toJson(res, 202, { accepted: true, normalizedEvent });
  }

  function handleMediaSource(res, body) {
    const source = validateMediaSource(body, config);
    if (source.error) {
      toJson(res, 400, { error: source.error });
      return;
    }
    updateState((draft) => {
      draft.mediaSources = draft.mediaSources.filter((entry) => entry.id !== source.id).concat(source);
    }, 'media_updated');
    audit('media.source.updated', { id: source.id, kind: source.kind, simulated: source.simulated });
    toJson(res, 201, { source });
  }

  function handleSecureBrowserLaunch(res, body) {
    const session = validateSecureBrowserTarget(body, config);
    if (session.error) {
      toJson(res, 400, { error: session.error });
      return;
    }
    updateState((draft) => {
      draft.secureBrowserSessions.push(session);
    }, 'browser_updated');
    audit('secure_browser.launched', { origin: session.origin, mode: session.mode });
    toJson(res, 201, { session });
  }

  function handleSecureBrowserClear(res, body) {
    const sessionId = String(body.sessionId || '').trim();
    updateState((draft) => {
      draft.secureBrowserSessions = sessionId
        ? draft.secureBrowserSessions.filter((session) => session.id !== sessionId)
        : [];
    }, 'browser_updated');
    audit('secure_browser.cleared', { sessionId: sessionId || 'all' });
    toJson(res, 200, { cleared: true, sessionId: sessionId || 'all' });
  }

  async function handleSimulateTick(res) {
    const syntheticBody = {
      incidentId: `SIM-${Date.now()}`,
      customer: 'Simulation Customer',
      origin: 'SIMULATION',
      source: 'demo-generator',
      description: 'Simulated roadside battery assist request',
      serviceType: 'battery_electrical_help'
    };
    const fakeReq = { headers: { 'idempotency-key': syntheticBody.incidentId } };
    await handleIncident(fakeReq, res, syntheticBody);
  }

  function setCommonHeaders(req, res) {
    const origin = req.headers.origin;
    if (origin && config.allowedCorsOrigins.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
    }
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type,authorization,x-ops-token,idempotency-key');
    res.setHeader('content-security-policy', createCsp(config));
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'SAMEORIGIN');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('cache-control', 'no-store');
  }

  const server = http.createServer(async (req, res) => {
    setCommonHeaders(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!rateLimiter.check(getClientIp(req))) {
      toJson(res, 429, { error: 'Rate limit exceeded' });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (assets[url.pathname] && req.method === 'GET') {
      const asset = assets[url.pathname];
      res.writeHead(200, { 'content-type': asset.contentType });
      res.end(readStaticFile(asset.file));
      return;
    }

    if (url.pathname === '/health/live' && req.method === 'GET') {
      toJson(res, 200, { ok: true, label: config.appLabel, at: now() });
      return;
    }

    if (url.pathname === '/health/ready' && req.method === 'GET') {
      toJson(res, 200, {
        ok: true,
        dataDir: config.dataDir,
        simulationMode: config.simulationMode,
        teamsMode: teams.getHealth().mode,
        graceAiMode: config.graceAiEndpoint && config.graceAiApiKey ? 'external' : 'simulation'
      });
      return;
    }

    if (url.pathname === '/api/config' && req.method === 'GET') {
      toJson(res, 200, {
        label: config.appLabel,
        simulationMode: config.simulationMode,
        supportedServices: SUPPORTED_SERVICES,
        policyLabel: POLICY_LABEL,
        secureBrowserAllowlist: config.secureBrowserAllowlist,
        mediaAllowlist: config.mediaAllowlist
      });
      return;
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      if (!validateAuth(req, config)) {
        toJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      toJson(res, 200, getPublicState());
      return;
    }

    if (url.pathname === '/api/audit' && req.method === 'GET') {
      if (!validateAuth(req, config)) {
        toJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      toJson(res, 200, { events: state.auditTail });
      return;
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      if (!validateAuth(req, config)) {
        toJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        connection: 'keep-alive',
        'cache-control': 'no-cache'
      });
      res.write(`data: ${JSON.stringify({ type: 'snapshot', at: now(), payload: getPublicState() })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    const requiresAuth = req.method === 'POST' && url.pathname !== '/api/teams/events';
    if (requiresAuth && !validateAuth(req, config)) {
      toJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    let body = {};
    if (req.method === 'POST') {
      try {
        body = await parseBody(req, res, config.maxBodyBytes);
        if (body === null) {
          return;
        }
      } catch (error) {
        toJson(res, error.statusCode || 400, { error: error.message });
        return;
      }
    }

    try {
      if (url.pathname === '/api/incidents' && req.method === 'POST') {
        await handleIncident(req, res, body);
        return;
      }
      if (url.pathname.startsWith('/api/dispatch/') && url.pathname.endsWith('/approve') && req.method === 'POST') {
        const queueId = url.pathname.split('/')[3];
        handleApprove(res, body, queueId);
        return;
      }
      if (url.pathname === '/api/automation/pause' && req.method === 'POST') {
        handleAutomationPause(res, body);
        return;
      }
      if (url.pathname === '/api/teams/notify' && req.method === 'POST') {
        await handleTeamsNotify(res, body);
        return;
      }
      if (url.pathname === '/api/teams/events' && req.method === 'POST') {
        handleInboundTeams(req, res, body);
        return;
      }
      if (url.pathname === '/api/media/sources' && req.method === 'POST') {
        handleMediaSource(res, body);
        return;
      }
      if (url.pathname === '/api/secure-browser/launch' && req.method === 'POST') {
        handleSecureBrowserLaunch(res, body);
        return;
      }
      if (url.pathname === '/api/secure-browser/clear' && req.method === 'POST') {
        handleSecureBrowserClear(res, body);
        return;
      }
      if (url.pathname === '/api/simulate/tick' && req.method === 'POST') {
        if (!config.simulationMode) {
          toJson(res, 409, { error: 'Simulation mode is disabled' });
          return;
        }
        await handleSimulateTick(res);
        return;
      }
    } catch (error) {
      audit('request.error', { path: url.pathname, message: error.message });
      toJson(res, 500, { error: 'Internal server error' });
      return;
    }

    toJson(res, 404, { error: 'Not found' });
  });

  function start() {
    return new Promise((resolve) => {
      server.listen(config.port, () => {
        persist();
        audit('system.started', { port: server.address().port, simulationMode: config.simulationMode });
        if (config.simulationMode && !simulationInterval) {
          simulationInterval = setInterval(() => {
            const simulatedStatus = state.mediaSources.map((source) => ({
              ...source,
              state: source.simulated ? 'simulated' : source.state,
              lastUpdatedAt: now()
            }));
            updateState((draft) => {
              draft.mediaSources = simulatedStatus;
            }, 'media_updated');
          }, 15_000);
          simulationInterval.unref();
        }
        resolve(server.address().port);
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      audit('system.stopping', {});
      if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
      }
      for (const client of sseClients) {
        client.end();
      }
      server.close(() => {
        resolve();
      });
    });
  }

  return { audit, config, getPublicState, server, start, stop, storage };
}

module.exports = { MONITOR_KEYS, createServer, loadConfig };
