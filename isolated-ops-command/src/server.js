const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DataStore } = require('./dataStore');
const { LearningSystem } = require('./learningSystem');

function createServer(options = {}) {
  const app = express();
  app.use(express.json({ limit: '250kb' }));

  const dataDir = options.dataDir || path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const authToken = options.authToken || process.env.OPS_COMMAND_TOKEN;
  if (!authToken) {
    throw new Error('OPS_COMMAND_TOKEN required for isolated-ops-command');
  }
  const store = new DataStore(dataDir);
  const learning = new LearningSystem(store);

  const sseClients = new Set();
  learning.subscribe((event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  });

  function stableJson(value) {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableJson(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      const keys = Object.keys(value).sort();
      const entries = keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
      return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function validateAuditChain(entries) {
    if (!Array.isArray(entries)) return false;
    for (let i = 0; i < entries.length; i += 1) {
      const current = entries[i];
      const previous = i > 0 ? entries[i - 1] : null;
      if (i > 0 && current.previousHash !== previous.hash) {
        return false;
      }
      const { hash, ...withoutHash } = current;
      const calculated = crypto.createHash('sha256').update(stableJson(withoutHash)).digest('hex');
      if (hash !== calculated) {
        return false;
      }
    }
    return true;
  }

  function redactError(error) {
    const safeCodes = new Set([
      'idempotency_key_required',
      'unauthorized',
      'forbidden',
      'not_found',
      'event_type_not_authorized',
      'learning_paused',
      'consent_required',
      'invalid_feedback_verdict',
      'action_not_allowlisted',
      'human_approval_required',
      'policy_no_tow_no_winch',
      'untrusted_source_action_blocked',
      'lesson_not_found',
      'invalid_review_decision',
      'rollback_requires_approved_lesson',
      'evaluation_not_found',
      'invalid_restore_payload',
      'legal_hold_active',
      'incident_id_required',
      'feedback_required_fields_missing',
      'invalid_actions_schema'
    ]);
    const safeCode = safeCodes.has(error.message) ? error.message : 'invalid_request';
    return {
      error: 'request_failed',
      code: safeCode
    };
  }

  function requireAuth(req, res, next) {
    const value = req.headers.authorization || '';
    const token = value.startsWith('Bearer ')
      ? value.slice('Bearer '.length)
      : value.startsWith('Token ')
        ? value.slice('Token '.length)
        : null;
    if (!token || token !== authToken) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      const role = req.headers['x-ops-role'];
      if (!role || !roles.includes(role)) {
        return res.status(403).json({ error: 'forbidden', requiredRoles: roles });
      }
      req.opsRole = role;
      return next();
    };
  }

  function mutation(handler) {
    return async (req, res) => {
      const key = req.headers['idempotency-key'];
      if (!key) {
        return res.status(400).json({ error: 'idempotency_key_required' });
      }

      const scopeKey = `${req.method}:${req.path}:${req.headers['x-ops-user'] || req.opsRole || 'anonymous'}:${key}`;
      const existing = store.getIdempotency(scopeKey);
      if (existing) {
        return res.status(existing.status).json(existing.body);
      }

      try {
        const result = await handler(req, res);
        if (!result || res.headersSent) {
          return result;
        }

        const status = result.status || 200;
        const body = result.body || result;
        store.upsertIdempotency(scopeKey, { status, body });
        store.persistAll();
        return res.status(status).json(body);
      } catch (error) {
        const statusMap = {
          unauthorized: 401,
          forbidden: 403,
          lesson_not_found: 404,
          evaluation_not_found: 404
        };
        return res.status(statusMap[error.message] || 400).json(redactError(error));
      }
    };
  }

  app.get('/api/ops/intelligence/monitor', requireAuth, (_req, res) => {
    res.json({
      graceIntelligence: learning.getMonitorStatus(),
      visibleLearningIndicator: learning.getMonitorStatus().learningStatusLabel
    });
  });

  app.get('/api/ops/intelligence/stream', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ updateType: 'connected', status: learning.getMonitorStatus() })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  app.post('/api/ops/events', requireAuth, requireRole('operator', 'reviewer', 'admin'), mutation((req) => {
    const actor = req.headers['x-ops-user'] || 'operator';
    const data = learning.ingestObservation(req.body, actor);
    return {
      status: 202,
      body: {
        accepted: true,
        observationId: data.observation.id,
        candidateLessonId: data.candidateLesson ? data.candidateLesson.id : null
      }
    };
  }));

  app.post('/api/ops/feedback', requireAuth, requireRole('operator', 'reviewer', 'admin'), mutation((req) => {
    const actor = req.headers['x-ops-user'] || 'operator';
    const feedback = learning.submitFeedback(req.body, actor);
    return { status: 201, body: { feedback } };
  }));

<<<<<<< HEAD
  app.get('/api/ops/lessons/candidates', requireAuth, requireRole('reviewer', 'admin'), (_req, res) => {
    res.json({ lessons: learning.listCandidateLessons() });
=======
function sanitizeObjectArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => deepSanitize(entry));
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
>>>>>>> origin/main
  });

  app.post('/api/ops/lessons/:lessonId/review', requireAuth, requireRole('reviewer', 'admin'), mutation((req) => {
    const actor = req.headers['x-ops-user'] || 'reviewer';
    const lesson = learning.reviewLesson(req.params.lessonId, req.body.decision, actor, req.body.note);
    return { status: 200, body: { lesson } };
  }));

  app.get('/api/ops/knowledge/search', requireAuth, requireRole('operator', 'reviewer', 'admin'), (req, res) => {
    const knowledge = learning.searchKnowledge(req.query.q, {
      equipment: req.query.equipment
    }, req.headers['x-ops-user'] || req.opsRole || 'operator');

    res.json({
      results: knowledge,
      disclaimer: 'Grace is an AI assistant. Unreviewed, expired, or rolled-back lessons are excluded from authoritative responses.'
    });
  });

  app.post('/api/ops/evaluations/run', requireAuth, requireRole('reviewer', 'admin'), mutation((req) => {
    const actor = req.headers['x-ops-user'] || 'reviewer';
    const evaluation = learning.runEvaluation(req.body.scenarios, actor);
    return { status: 201, body: { evaluation } };
  }));

  app.get('/api/ops/evaluations/status/:evaluationId', requireAuth, requireRole('operator', 'reviewer', 'admin'), (req, res) => {
    const evaluation = store.state.evaluations.find((item) => item.id === req.params.evaluationId);
    if (!evaluation) {
      return res.status(404).json({ error: 'evaluation_not_found' });
    }

    return res.json({ evaluation });
  });

  app.post('/api/ops/learning/pause', requireAuth, requireRole('reviewer', 'admin'), mutation((req) => {
    const actor = req.headers['x-ops-user'] || 'reviewer';
    const paused = store.setLearningPaused(true, actor);
    learning.publishMonitor('learning_toggled', { paused });
    return { status: 200, body: { learningPaused: paused } };
  }));

  app.post('/api/ops/learning/resume', requireAuth, requireRole('reviewer', 'admin'), mutation((req) => {
    const actor = req.headers['x-ops-user'] || 'reviewer';
    const paused = store.setLearningPaused(false, actor);
    learning.publishMonitor('learning_toggled', { paused });
    return { status: 200, body: { learningPaused: paused } };
  }));

  app.post('/api/ops/provider/health', requireAuth, requireRole('reviewer', 'admin'), mutation((req) => {
    const actor = req.headers['x-ops-user'] || 'reviewer';
    const healthy = req.body?.healthy !== false;
    if (!healthy) {
      store.setDegradedMode(true, 'provider_health_failed', actor);
    } else {
      store.setDegradedMode(false, null, actor);
    }
    learning.publishMonitor('provider_health_updated', { healthy });
    return { status: 200, body: { healthy, degradedMode: store.state.runtime.degradedMode } };
  }));

  app.post('/api/ops/recommendations/validate', requireAuth, requireRole('operator', 'reviewer', 'admin'), mutation((req) => {
    const validated = learning.validateModelResponse(req.body.response, {
      retrievedDocuments: req.body.retrievedDocuments
    });
    return { status: 200, body: { validated } };
  }));

  app.get('/api/ops/metrics', requireAuth, requireRole('operator', 'reviewer', 'admin'), (_req, res) => {
    const latestEvaluation = store.state.evaluations[store.state.evaluations.length - 1] || null;
    res.json({
      monitor: learning.getMonitorStatus(),
      latestEvaluationMetrics: latestEvaluation ? latestEvaluation.metrics : null,
      totals: {
        observations: store.state.observations.length,
        feedback: store.state.feedback.length,
        lessons: store.state.lessons.length,
        evaluations: store.state.evaluations.length,
        auditEvents: store.state.audit.length
      }
    });
  });

  app.get('/api/ops/audit', requireAuth, requireRole('admin'), (_req, res) => {
    res.json({ audit: store.state.audit });
  });

  app.get('/api/ops/governance/export', requireAuth, requireRole('admin'), (_req, res) => {
    const { idempotency, ...exportData } = store.state;
    res.json({
      exportedAt: new Date().toISOString(),
      data: exportData,
      note: 'Synthetic prototype export. Use documented backup/restore and legal hold procedures before production use.'
    });
  });

  app.post('/api/ops/governance/restore', requireAuth, requireRole('admin'), mutation((req) => {
    const actor = req.headers['x-ops-user'] || 'admin';
    if (!req.body || typeof req.body !== 'object' || !req.body.data) {
      throw new Error('invalid_restore_payload');
    }

    const data = req.body.data;
    const preservedAudit = [...store.state.audit];
    const previousAuditLength = preservedAudit.length;
    const previousRuntime = { ...store.state.runtime };
    if (Array.isArray(data.audit) && data.audit.length) {
      if (!validateAuditChain(data.audit)) {
        throw new Error('invalid_restore_payload');
      }
    }
    store.state.observations = Array.isArray(data.observations) ? data.observations : [];
    store.state.feedback = Array.isArray(data.feedback) ? data.feedback : [];
    store.state.lessons = Array.isArray(data.lessons) ? data.lessons : [];
    store.state.knowledgeBases = data.knowledgeBases && typeof data.knowledgeBases === 'object'
      ? data.knowledgeBases
      : store.state.knowledgeBases;
    store.state.evaluations = Array.isArray(data.evaluations) ? data.evaluations : [];
    store.state.idempotency = {};
    if (data.runtime && typeof data.runtime === 'object') {
      if (typeof data.runtime.retentionDays === 'number' && data.runtime.retentionDays > 0) {
        store.state.runtime.retentionDays = Math.floor(data.runtime.retentionDays);
      }
      if (typeof data.runtime.consentRequired === 'boolean') {
        store.state.runtime.consentRequired = data.runtime.consentRequired;
      }
      if (data.runtime.provider && typeof data.runtime.provider === 'object') {
        const allowedProvider = {};
        for (const key of ['name', 'model', 'version']) {
          if (typeof data.runtime.provider[key] === 'string' && data.runtime.provider[key].length) {
            allowedProvider[key] = data.runtime.provider[key];
          }
        }
        store.state.runtime.provider = {
          ...store.state.runtime.provider,
          ...allowedProvider
        };
      }
    }
    store.state.runtime.learningPaused = previousRuntime.learningPaused;
    store.state.runtime.legalHold = previousRuntime.legalHold;
    store.state.runtime.legalHoldReason = previousRuntime.legalHoldReason;
    store.state.audit = preservedAudit;

    store.addAudit({
      action: 'governance.restore',
      entityType: 'governance',
      entityId: 'restore',
      actor,
      details: {
        restored: true,
        preservedAuditEvents: previousAuditLength,
        importedAuditEvents: Array.isArray(data.audit) ? data.audit.length : 0
      }
    });
    store.persistAll();

    learning.publishMonitor('restore_completed', { restored: true });
    return { status: 200, body: { restored: true } };
  }));

  app.post('/api/ops/governance/anonymize', requireAuth, requireRole('admin'), mutation((req) => {
    const actor = req.headers['x-ops-user'] || 'admin';
    if (store.state.runtime.legalHold) {
      throw new Error('legal_hold_active');
    }
    const cutoffDays = Number(req.body.days) || store.state.runtime.retentionDays;
    const cutoff = Date.now() - cutoffDays * 24 * 60 * 60 * 1000;

    const originalCount = store.state.observations.length;
    store.state.observations = store.state.observations.map((item) => {
      const created = Date.parse(item.createdAt);
      if (Number.isFinite(created) && created < cutoff) {
        return {
          ...item,
          incidentId: null,
          data: { redacted: true },
          anonymized: true
        };
      }
      return item;
    });

    store.addAudit({
      action: 'governance.anonymize',
      entityType: 'governance',
      entityId: 'retention_cleanup',
      actor,
      details: {
        cutoffDays,
        scannedObservations: originalCount
      }
    });

    store.persistAll();
    return { status: 200, body: { anonymized: true, scannedObservations: originalCount } };
  }));

  app.post('/api/ops/governance/delete-incident', requireAuth, requireRole('admin'), mutation((req) => {
    const actor = req.headers['x-ops-user'] || 'admin';
    if (store.state.runtime.legalHold) {
      throw new Error('legal_hold_active');
    }
    const incidentId = req.body?.incidentId;
    if (!incidentId) {
      throw new Error('incident_id_required');
    }

    const before = store.state.observations.length;
    const removedObservationIds = new Set(
      store.state.observations
        .filter((item) => item.incidentId === incidentId)
        .map((item) => item.id)
    );

    store.state.observations = store.state.observations.filter((item) => item.incidentId !== incidentId);
    const removed = before - store.state.observations.length;
    const feedbackBefore = store.state.feedback.length;
    store.state.feedback = store.state.feedback.filter((item) => item.incidentId !== incidentId);
    const removedFeedback = feedbackBefore - store.state.feedback.length;

    const lessonsBefore = store.state.lessons.length;
    store.state.lessons = store.state.lessons.filter((item) => !removedObservationIds.has(item.source?.reference));
    const removedLessons = lessonsBefore - store.state.lessons.length;

    store.addAudit({
      action: 'governance.delete_incident',
      entityType: 'governance',
      entityId: incidentId,
      actor,
      details: {
        removedObservations: removed,
        removedFeedback,
        removedLessons
      }
    });
    store.persistAll();
    return {
      status: 200,
      body: { deleted: true, removedObservations: removed, removedFeedback, removedLessons }
    };
  }));

  app.post('/api/ops/governance/legal-hold', requireAuth, requireRole('admin'), mutation((req) => {
    const actor = req.headers['x-ops-user'] || 'admin';
    const enabled = req.body?.enabled === true;
    const reason = req.body?.reason || null;
    store.setLegalHold(enabled, reason, actor);
    learning.publishMonitor('legal_hold_toggled', { enabled, reason });
    return { status: 200, body: { legalHold: store.state.runtime.legalHold, reason: store.state.runtime.legalHoldReason } };
  }));

  app.post('/api/ops/governance/config', requireAuth, requireRole('admin'), mutation((req) => {
    const actor = req.headers['x-ops-user'] || 'admin';
    if (typeof req.body?.retentionDays === 'number' && req.body.retentionDays > 0) {
      store.state.runtime.retentionDays = Math.floor(req.body.retentionDays);
    }
    if (typeof req.body?.consentRequired === 'boolean') {
      store.state.runtime.consentRequired = req.body.consentRequired;
    }
    if (req.body?.provider && typeof req.body.provider === 'object') {
      store.state.runtime.provider = {
        ...store.state.runtime.provider,
        ...req.body.provider
      };
    }
    store.addAudit({
      action: 'governance.config_updated',
      entityType: 'governance',
      entityId: 'config',
      actor,
      details: {
        retentionDays: store.state.runtime.retentionDays,
        consentRequired: store.state.runtime.consentRequired,
        provider: store.state.runtime.provider
      }
    });
    store.persistAll();
    learning.publishMonitor('governance_config_updated', {
      retentionDays: store.state.runtime.retentionDays,
      consentRequired: store.state.runtime.consentRequired
    });
    return {
      status: 200,
      body: {
        retentionDays: store.state.runtime.retentionDays,
        consentRequired: store.state.runtime.consentRequired,
        provider: store.state.runtime.provider
      }
    };
  }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return {
<<<<<<< HEAD
    app,
    store,
    learning,
    close: () => {
      for (const client of sseClients) {
=======
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

function validateStartupConfig(config, storage) {
  if ((!config.opsToken || config.opsToken === 'change-me-isolated-ops') && !config.simulationMode) {
    throw new Error('ISOLATED_OPS_TOKEN must be configured with a non-default value before startup.');
  }
  storage.probeWritable();
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
  const sseClients = new Map();
  let started = false;
  const TRANSITIONS = {
    awaiting_human_approval: ['approved_dispatch'],
    approved_dispatch: ['technician_assigned'],
    auto_dispatched: ['technician_assigned'],
    technician_assigned: ['in_progress'],
    in_progress: ['completed'],
    completed: ['closed']
  };

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
    for (const res of sseClients.keys()) {
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
      incidents: state.incidents.slice(-10).map((incident) => ({
        incidentId: incident.incidentId,
        description: incident.description,
        status: incident.status,
        serviceType: incident.serviceType,
        source: incident.source,
        origin: incident.origin,
        createdAt: incident.createdAt
      })),
      dispatchQueue: state.dispatchQueue.slice(-10).map((item) => ({
        id: item.id,
        incidentId: item.incidentId,
        description: item.description,
        recommendedServiceType: item.recommendedServiceType,
        priority: item.priority,
        createdAt: item.createdAt,
        requiresHumanApproval: item.requiresHumanApproval,
        status: item.status,
        approvedBy: item.approvedBy,
        approvedAt: item.approvedAt,
        assignedTechnician: item.assignedTechnician,
        inProgressAt: item.inProgressAt,
        completedAt: item.completedAt,
        completionNotes: item.completionNotes,
        customerSafeSummary: item.customerSafeSummary,
        closedAt: item.closedAt,
        statusHistory: item.statusHistory || []
      })),
      activeUnits: state.activeUnits,
      policyRejections: state.policyRejections.slice(-10).map((item) => ({
        id: item.id,
        incidentId: item.incidentId,
        at: item.at,
        routedTo: item.routedTo,
        rejection: item.rejection
      })),
      auditTail: state.auditTail,
      mediaSources: state.mediaSources.map((source) => ({
        id: source.id,
        kind: source.kind,
        name: source.name,
        type: source.type,
        simulated: source.simulated,
        state: source.state,
        lastUpdatedAt: source.lastUpdatedAt,
        error: source.error,
        displayOrigin: sanitizeUrlOrigin(source.url)
      })),
      secureBrowserSessions: state.secureBrowserSessions.map((session) => ({
        id: session.id,
        origin: session.origin,
        hostname: session.hostname,
        mode: session.mode,
        state: session.state,
        launchedAt: session.launchedAt,
        expiresAt: session.expiresAt
      })),
      teamsHealth: teams.getHealth(),
      lastGraceAiDecision: state.lastGraceAiDecision,
      supportedServices: SUPPORTED_SERVICES,
      policyLabel: POLICY_LABEL
    };
  }

  function transitionQueueItem(queueId, body, opts = {}) {
    const requestedTransition = String(body.transition || opts.transition || '').trim();
    const operator = String(body.operator || '').trim();
    const notes = String(body.notes || '').trim();
    const idempotencyKey = String(opts.idempotencyKey || body.idempotencyKey || '').trim();
    if (!requestedTransition) {
      return { statusCode: 400, body: { error: 'transition is required' } };
    }
    if (!operator) {
      return { statusCode: 400, body: { error: 'operator is required' } };
    }
    const item = state.dispatchQueue.find((entry) => entry.id === queueId);
    if (!item) {
      return { statusCode: 404, body: { error: 'queue item not found' } };
    }

    const transitionKey = idempotencyKey ? `${queueId}:${idempotencyKey}` : '';
    if (transitionKey && state.transitionIdempotencyKeys[transitionKey]) {
      return state.transitionIdempotencyKeys[transitionKey];
    }

    const currentStatus = item.status;
    if (currentStatus === requestedTransition) {
      return { statusCode: 200, body: { ok: true, idempotent: true, queueItemId: queueId, status: currentStatus } };
    }
    const allowed = TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(requestedTransition)) {
      return { statusCode: 409, body: { error: `transition from ${currentStatus} to ${requestedTransition} is not allowed` } };
    }
    const completionNotes = String(body.completionNotes || notes || '').trim();
    const customerSafeSummary = String(body.customerSafeSummary || '').trim();
    if (requestedTransition === 'completed' && !completionNotes) {
      return { statusCode: 400, body: { error: 'completionNotes are required for completed transition' } };
    }
    if (requestedTransition === 'closed' && !customerSafeSummary) {
      return { statusCode: 400, body: { error: 'customerSafeSummary is required for closed transition' } };
    }

    const transitionAt = now();
    const result = { statusCode: 200, body: { ok: true, queueItemId: queueId, status: requestedTransition, operator } };
    updateState((draft) => {
      const target = draft.dispatchQueue.find((entry) => entry.id === queueId);
      target.status = requestedTransition;
      target.requiresHumanApproval = requestedTransition === 'awaiting_human_approval';
      target.statusHistory = (target.statusHistory || []).concat({
        from: currentStatus,
        to: requestedTransition,
        at: transitionAt,
        operator,
        notes
      });

      if (requestedTransition === 'approved_dispatch') {
        target.approvedBy = operator;
        target.approvedAt = transitionAt;
      }
      if (requestedTransition === 'technician_assigned') {
        target.assignedTechnician = String(body.technician || body.technicianName || operator).slice(0, 120);
      }
      if (requestedTransition === 'in_progress') {
        target.inProgressAt = transitionAt;
      }
      if (requestedTransition === 'completed') {
        target.completionNotes = completionNotes.slice(0, 1200);
        target.completedAt = transitionAt;
      }
      if (requestedTransition === 'closed') {
        target.customerSafeSummary = customerSafeSummary.replace(/[<>]/g, '').slice(0, 1200);
        target.closedAt = transitionAt;
      }
      if (transitionKey) {
        draft.transitionIdempotencyKeys[transitionKey] = result;
      }
    }, 'dispatch_updated');

    audit('work_order.transition', {
      queueItemId: queueId,
      from: currentStatus,
      to: requestedTransition,
      operator,
      notes
    });
    return result;
  }

  function handleTechnicianCopilot(res, body) {
    const source = String(body.source || '').trim();
    if (!source) {
      toJson(res, 400, { error: 'source is required and must be an authorized knowledge source' });
      return;
    }
    if (!config.technicianKnowledgeSources.includes(source)) {
      toJson(res, 403, { error: 'source is not authorized for technician copilot' });
      return;
    }
    const domain = String(body.domain || 'diagnostic').toLowerCase();
    const escalationRequired = ['legal', 'accounting', 'tax', 'business'].includes(domain);
    const result = {
      engineVehicle: String(body.engineVehicle || body.vehicle || 'Unknown vehicle').slice(0, 160),
      codeFamily: String(body.codeFamily || 'general').slice(0, 80),
      symptoms: String(body.symptoms || '').slice(0, 500),
      measurements: String(body.measurements || '').slice(0, 500),
      safetyState: String(body.safetyState || 'verify lockout-tagout and scene safety').slice(0, 240),
      source,
      lastVerifiedDate: String(body.lastVerifiedDate || new Date().toISOString().slice(0, 10)),
      confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : 0.66,
      escalation: escalationRequired ? 'professional_review_required' : (String(body.escalation || 'field_supervisor_review').slice(0, 120)),
      advisory: escalationRequired
        ? 'Informational drafting assistance only. Route to licensed legal/accounting/tax/business professionals before action.'
        : String(body.query || 'Collect fault codes, verify safety state, and follow internal SOP diagnostics.').slice(0, 800)
    };
    audit('technician.copilot.requested', { source: result.source, codeFamily: result.codeFamily, escalation: result.escalation });
    toJson(res, 200, { result });
  }

  async function handleIncident(req, res, body) {
    const validated = validateIncident(body);
    if (validated.error) {
      toJson(res, 400, { error: validated.error });
      return;
    }

    const idempotencyKey = String(req.headers['idempotency-key'] || validated.incidentId);
    if (state.idempotencyKeys[idempotencyKey]) {
      const replay = state.idempotencyKeys[idempotencyKey];
      toJson(res, replay.statusCode, replay.body);
      return;
    }
    const activeQueueItems = state.dispatchQueue.filter((entry) => entry.status !== 'closed').length;
    if (activeQueueItems >= config.maxQueueItems) {
      const responseBody = { error: 'Dispatch queue is at capacity. Pause intake and complete existing work orders.' };
      audit('dispatch.queue.capacity_reached', { queueLength: activeQueueItems, maxQueueItems: config.maxQueueItems });
      toJson(res, 503, responseBody);
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
      const responseBody = { error: policyRejection.message, rejection };
      updateState((draft) => {
        draft.policyRejections.push(rejection);
        draft.incidents.push({ ...validated, status: 'policy_rejected', createdAt: now() });
        draft.idempotencyKeys[idempotencyKey] = { statusCode: 422, body: responseBody };
      }, 'policy_rejection');
      audit('policy.rejected', rejection);
      await teams.postStatusSummary({ text: `Policy rejection logged for incident ${validated.incidentId}. External referral required.` });
      toJson(res, 422, responseBody);
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
      const responseBody = { error: decision.rejection.message, rejection };
      updateState((draft) => {
        draft.policyRejections.push(rejection);
        draft.incidents.push({ ...validated, status: 'policy_rejected', createdAt: now() });
        draft.lastGraceAiDecision = decision;
        draft.idempotencyKeys[idempotencyKey] = { statusCode: 422, body: responseBody };
      }, 'policy_rejection');
      audit('policy.rejected_ai_output', rejection);
      toJson(res, 422, responseBody);
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
      aiSummary: decision.summary,
      statusHistory: [{
        from: 'intake',
        to: 'awaiting_human_approval',
        at: now(),
        operator: 'system',
        notes: 'Incident triaged by policy + Grace adapter'
      }]
    };

    const canAutoDispatch = config.autoDispatchEnabled
      && !state.automationPaused
      && LOW_RISK_AUTO_DISPATCH_SERVICES.includes(queueItem.recommendedServiceType)
      && decision.requiresHumanApproval === false;

    if (canAutoDispatch) {
      queueItem.requiresHumanApproval = false;
      queueItem.status = 'auto_dispatched';
      queueItem.dispatchedAt = now();
      queueItem.statusHistory.push({
        from: 'awaiting_human_approval',
        to: 'auto_dispatched',
        at: queueItem.dispatchedAt,
        operator: 'system',
        notes: 'Low-risk auto-dispatch policy path'
      });
    }

    const responseBody = { incident: validated, queueItem, decision, automationPaused: state.automationPaused };
    updateState((draft) => {
      draft.lastGraceAiDecision = decision;
      draft.incidents.push({ ...validated, status: queueItem.status, createdAt: now() });
      draft.dispatchQueue.push(queueItem);
      draft.idempotencyKeys[idempotencyKey] = { statusCode: 202, body: responseBody };
    }, 'incident_updated');
    audit(canAutoDispatch ? 'dispatch.auto_dispatched' : 'dispatch.recommendation_created', { incidentId: validated.incidentId, queueItemId: queueItem.id });
    await teams.postStatusSummary({ text: `Incident ${validated.incidentId} triaged for ${queueItem.recommendedServiceType.replace(/_/g, ' ')}.` });
    toJson(res, 202, responseBody);
  }

  function handleApprove(req, res, body, queueId) {
    const result = transitionQueueItem(queueId, body, {
      transition: 'approved_dispatch',
      idempotencyKey: String(req.headers['idempotency-key'] || body.idempotencyKey || '')
    });
    if (result.statusCode === 200 && !result.body.idempotent) {
      audit('dispatch.approved', { queueItemId: queueId, operator: String(body.operator || '').trim() });
    }
    toJson(res, result.statusCode, result.body);
  }

  function handleWorkOrderTransition(req, res, body, queueId) {
    const result = transitionQueueItem(queueId, body, {
      idempotencyKey: String(req.headers['idempotency-key'] || body.idempotencyKey || '')
    });
    toJson(res, result.statusCode, result.body);
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

  function handleBackupExport(res) {
    audit('backup.exported', { requestedAt: now() });
    const snapshot = storage.exportSnapshot();
    toJson(res, 200, snapshot);
  }

  function handleBackupRestore(res, body) {
    if (!body || typeof body !== 'object' || !body.state || !Array.isArray(body.audit)) {
      toJson(res, 400, { error: 'state and audit snapshot payload is required' });
      return;
    }
    if (!Array.isArray(body.state.dispatchQueue) || !Array.isArray(body.state.incidents) || !Array.isArray(body.state.policyRejections)) {
      toJson(res, 400, { error: 'snapshot state has an invalid shape' });
      return;
    }
    if (!body.audit.every((entry) => entry && typeof entry === 'object')) {
      toJson(res, 400, { error: 'snapshot audit entries must be objects' });
      return;
    }
    const safeState = deepSanitize({
      label: String(body.state.label || config.appLabel),
      simulationMode: Boolean(body.state.simulationMode),
      automationPaused: Boolean(body.state.automationPaused),
      automationPauseReason: String(body.state.automationPauseReason || ''),
      incidents: sanitizeObjectArray(body.state.incidents),
      dispatchQueue: sanitizeObjectArray(body.state.dispatchQueue),
      activeUnits: sanitizeObjectArray(body.state.activeUnits),
      policyRejections: sanitizeObjectArray(body.state.policyRejections),
      mediaSources: sanitizeObjectArray(body.state.mediaSources),
      secureBrowserSessions: sanitizeObjectArray(body.state.secureBrowserSessions),
      idempotencyKeys: body.state.idempotencyKeys && typeof body.state.idempotencyKeys === 'object' ? body.state.idempotencyKeys : {},
      transitionIdempotencyKeys: body.state.transitionIdempotencyKeys && typeof body.state.transitionIdempotencyKeys === 'object' ? body.state.transitionIdempotencyKeys : {},
      teamsEvents: sanitizeObjectArray(body.state.teamsEvents),
      lastGraceAiDecision: body.state.lastGraceAiDecision && typeof body.state.lastGraceAiDecision === 'object' ? body.state.lastGraceAiDecision : null
    });
    const safeAudit = sanitizeObjectArray(body.audit);
    const previewStorage = {
      loadState() {
        return safeState;
      },
      readAudit() {
        return safeAudit;
      }
    };
    const restoredState = createInitialState(config, previewStorage);
    storage.restoreSnapshot({ state: safeState, audit: safeAudit });
    state = restoredState;
    persist();
    emit('snapshot', { state: getPublicState() });
    toJson(res, 202, { restored: true, restoredAt: now() });
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

    if (!rateLimiter.check(getClientIp(req, config))) {
      toJson(res, 429, { error: 'Rate limit exceeded' });
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const requiresApiAuth = url.pathname.startsWith('/api/') && url.pathname !== '/api/teams/events';
    if (requiresApiAuth && !validateAuth(req, config)) {
      toJson(res, 401, { error: 'Unauthorized' });
      return;
    }

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
      const teamsHealth = teams.getHealth();
      const dependencies = {
        persistence: fs.existsSync(config.dataDir) ? 'online' : 'error',
        graceAi: config.graceAiEndpoint && config.graceAiApiKey ? 'configured' : 'simulation',
        teams: teamsHealth.lastError ? 'error' : (teamsHealth.mode || 'simulation')
      };
      const degraded = Object.values(dependencies).includes('error');
      toJson(res, 200, {
        ok: !degraded,
        dataDir: config.dataDir,
        simulationMode: config.simulationMode,
        teamsMode: teamsHealth.mode,
        graceAiMode: config.graceAiEndpoint && config.graceAiApiKey ? 'external' : 'simulation',
        dependencies,
        degraded
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
        mediaAllowlist: config.mediaAllowlist,
        technicianKnowledgeSources: config.technicianKnowledgeSources,
        maxQueueItems: config.maxQueueItems,
        graceAvatarProfile: config.graceAvatarProfile,
        graceVoiceProfile: config.graceVoiceProfile
      });
      return;
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      toJson(res, 200, getPublicState());
      return;
    }

    if (url.pathname === '/api/audit' && req.method === 'GET') {
      toJson(res, 200, { events: state.auditTail });
      return;
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        connection: 'keep-alive',
        'cache-control': 'no-cache'
      });
      res.write(`data: ${JSON.stringify({ type: 'snapshot', at: now(), payload: { state: getPublicState() } })}\n\n`);
      const timeoutId = setTimeout(() => {
        if (!res.destroyed) {
          res.write(`data: ${JSON.stringify({ type: 'session_expiring', at: now(), payload: { reason: 'ttl_reached' } })}\n\n`);
          res.end();
        }
      }, config.sseSessionTtlMs);
      timeoutId.unref();
      sseClients.set(res, timeoutId);
      const cleanup = () => {
        const activeTimeout = sseClients.get(res);
        if (activeTimeout) {
          clearTimeout(activeTimeout);
        }
        sseClients.delete(res);
      };
      req.on('close', cleanup);
      res.on('close', cleanup);
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
        handleApprove(req, res, body, queueId);
        return;
      }
      if (url.pathname.startsWith('/api/work-orders/') && url.pathname.endsWith('/transition') && req.method === 'POST') {
        const queueId = url.pathname.split('/')[3];
        handleWorkOrderTransition(req, res, body, queueId);
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
      if (url.pathname === '/api/technician/copilot' && req.method === 'POST') {
        handleTechnicianCopilot(res, body);
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
      if (url.pathname === '/api/admin/backup/export' && req.method === 'GET') {
        handleBackupExport(res);
        return;
      }
      if (url.pathname === '/api/admin/backup/restore' && req.method === 'POST') {
        handleBackupRestore(res, body);
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
    return new Promise((resolve, reject) => {
      validateStartupConfig(config, storage);
      const onError = (error) => {
        server.off('error', onError);
        reject(error);
      };
      server.once('error', onError);
      server.listen(config.port, () => {
        server.off('error', onError);
        started = true;
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
      if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
      }
      if (!started || !server.listening) {
        resolve();
        return;
      }
      audit('system.stopping', {});
      for (const [client, timeoutId] of sseClients.entries()) {
        clearTimeout(timeoutId);
>>>>>>> origin/main
        client.end();
      }
      sseClients.clear();
    }
  };
}

module.exports = {
  createServer
};
