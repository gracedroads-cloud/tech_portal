const express = require('express');
const path = require('path');
const fs = require('fs');
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
      'incident_id_required'
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
    return (req, res) => {
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
        const result = handler(req, res);
        if (!result || res.headersSent) {
          return result;
        }

        const status = result.status || 200;
        const body = result.body || result;
        store.upsertIdempotency(scopeKey, { status, body });
        store.persistAll();
        return res.status(status).json(body);
      } catch (error) {
        return res.status(400).json(redactError(error));
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

  app.get('/api/ops/lessons/candidates', requireAuth, requireRole('reviewer', 'admin'), (_req, res) => {
    res.json({ lessons: learning.listCandidateLessons() });
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
    res.json({
      exportedAt: new Date().toISOString(),
      data: store.state,
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
      const chainValid = data.audit.every((entry, index) => index === 0 || entry.previousHash === data.audit[index - 1].hash);
      if (!chainValid) {
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
    store.state.idempotency = data.idempotency && typeof data.idempotency === 'object' ? data.idempotency : {};
    if (data.runtime && typeof data.runtime === 'object') {
      if (typeof data.runtime.retentionDays === 'number' && data.runtime.retentionDays > 0) {
        store.state.runtime.retentionDays = Math.floor(data.runtime.retentionDays);
      }
      if (typeof data.runtime.consentRequired === 'boolean') {
        store.state.runtime.consentRequired = data.runtime.consentRequired;
      }
      if (data.runtime.provider && typeof data.runtime.provider === 'object') {
        store.state.runtime.provider = {
          ...store.state.runtime.provider,
          ...data.runtime.provider
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
    app,
    store,
    learning,
    close: () => {
      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();
    }
  };
}

module.exports = {
  createServer
};
