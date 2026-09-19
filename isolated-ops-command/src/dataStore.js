const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function stableJson(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
  fs.renameSync(tmpPath, filePath);
}

class DataStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.files = {
      observations: path.join(dataDir, 'observations.json'),
      feedback: path.join(dataDir, 'feedback.json'),
      lessons: path.join(dataDir, 'lessons.json'),
      knowledgeBases: path.join(dataDir, 'knowledge_bases.json'),
      evaluations: path.join(dataDir, 'evaluations.json'),
      idempotency: path.join(dataDir, 'idempotency.json'),
      audit: path.join(dataDir, 'audit.json'),
      state: path.join(dataDir, 'state.json')
    };

    this.state = {
      observations: [],
      feedback: [],
      lessons: [],
      knowledgeBases: {
        sops: [],
        equipmentReferences: [],
        resolvedCaseSummaries: [],
        operatorCorrections: [],
        failurePatterns: [],
        organizationPreferences: []
      },
      evaluations: [],
      idempotency: {},
      audit: [],
      runtime: {
        learningPaused: false,
        retentionDays: 90,
        consentRequired: true,
        legalHold: false,
        legalHoldReason: null,
        provider: { name: 'simulation', model: 'synthetic-fixture-v1' },
        lastSuccessfulEvaluationAt: null,
        degradedMode: false,
        degradedReason: null
      }
    };

    this.load();
  }

  load() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      return;
    }

    const map = {
      observations: 'observations',
      feedback: 'feedback',
      lessons: 'lessons',
      knowledgeBases: 'knowledgeBases',
      evaluations: 'evaluations',
      idempotency: 'idempotency',
      audit: 'audit'
    };

    for (const [key, fileKey] of Object.entries(map)) {
      const filePath = this.files[fileKey];
      if (fs.existsSync(filePath)) {
        this.state[key] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    }

    if (fs.existsSync(this.files.state)) {
      this.state.runtime = {
        ...this.state.runtime,
        ...JSON.parse(fs.readFileSync(this.files.state, 'utf8'))
      };
    }
  }

  persistAll() {
    writeJsonAtomic(this.files.observations, this.state.observations);
    writeJsonAtomic(this.files.feedback, this.state.feedback);
    writeJsonAtomic(this.files.lessons, this.state.lessons);
    writeJsonAtomic(this.files.knowledgeBases, this.state.knowledgeBases);
    writeJsonAtomic(this.files.evaluations, this.state.evaluations);
    writeJsonAtomic(this.files.idempotency, this.state.idempotency);
    writeJsonAtomic(this.files.audit, this.state.audit);
    writeJsonAtomic(this.files.state, this.state.runtime);
  }

  nowIso() {
    return new Date().toISOString();
  }

  addAudit({ action, entityType, entityId, actor, details }) {
    const timestamp = this.nowIso();
    const previous = this.state.audit[this.state.audit.length - 1];
    const previousHash = previous ? previous.hash : null;
    const payload = {
      sequence: this.state.audit.length + 1,
      timestamp,
      action,
      entityType,
      entityId,
      actor,
      details,
      previousHash
    };

    payload.hash = crypto
      .createHash('sha256')
      .update(stableJson(payload))
      .digest('hex');

    this.state.audit.push(payload);
    return payload;
  }

  upsertIdempotency(key, response) {
    this.state.idempotency[key] = {
      ...response,
      storedAt: this.nowIso()
    };
    return this.state.idempotency[key];
  }

  getIdempotency(key) {
    return this.state.idempotency[key] || null;
  }

  setLearningPaused(paused, actor) {
    this.state.runtime.learningPaused = paused;
    this.addAudit({
      action: paused ? 'learning.paused' : 'learning.resumed',
      entityType: 'runtime',
      entityId: 'learning',
      actor,
      details: { paused }
    });
    this.persistAll();
    return this.state.runtime.learningPaused;
  }

  setLegalHold(enabled, reason, actor) {
    this.state.runtime.legalHold = enabled;
    this.state.runtime.legalHoldReason = enabled ? (reason || 'unspecified') : null;
    this.addAudit({
      action: enabled ? 'governance.legal_hold_enabled' : 'governance.legal_hold_disabled',
      entityType: 'governance',
      entityId: 'legal_hold',
      actor,
      details: {
        enabled,
        reason: this.state.runtime.legalHoldReason
      }
    });
    this.persistAll();
  }

  setDegradedMode(degradedMode, reason, actor) {
    this.state.runtime.degradedMode = degradedMode;
    this.state.runtime.degradedReason = reason || null;
    this.addAudit({
      action: degradedMode ? 'runtime.degraded' : 'runtime.normal',
      entityType: 'runtime',
      entityId: 'mode',
      actor,
      details: { degradedMode, reason: reason || null }
    });
    this.persistAll();
  }

  addObservation(observation, actor) {
    this.state.observations.push(observation);
    this.addAudit({
      action: 'observation.created',
      entityType: 'observation',
      entityId: observation.id,
      actor,
      details: {
        type: observation.type,
        incidentId: observation.incidentId || null
      }
    });
    this.persistAll();
    return observation;
  }

  addFeedback(feedback, actor) {
    this.state.feedback.push(feedback);
    this.addAudit({
      action: 'feedback.created',
      entityType: 'feedback',
      entityId: feedback.id,
      actor,
      details: {
        recommendationId: feedback.recommendationId,
        verdict: feedback.verdict,
        incidentId: feedback.incidentId
      }
    });
    this.persistAll();
    return feedback;
  }

  addLesson(lesson, actor) {
    this.state.lessons.push(lesson);
    this.addAudit({
      action: 'lesson.candidate_created',
      entityType: 'lesson',
      entityId: lesson.id,
      actor,
      details: {
        state: lesson.approvalState,
        sourceType: lesson.source.type,
        scope: lesson.applicabilityScope
      }
    });
    this.persistAll();
    return lesson;
  }

  reviewLesson(lessonId, decision, actor, note) {
    const lesson = this.state.lessons.find((item) => item.id === lessonId);
    if (!lesson) {
      return null;
    }

    const now = this.nowIso();
    if (decision === 'approve') {
      lesson.approvalState = 'approved';
      lesson.approvedAt = now;
      lesson.lastReviewedDate = now;
      lesson.rollbackReason = null;
    } else if (decision === 'reject') {
      lesson.approvalState = 'rejected';
      lesson.lastReviewedDate = now;
      lesson.rejectionReason = note || 'Rejected by reviewer';
    } else if (decision === 'rollback') {
      lesson.approvalState = 'rolled_back';
      lesson.lastReviewedDate = now;
      lesson.rollbackReason = note || 'Rolled back by reviewer';
    } else {
      return null;
    }

    this.addAudit({
      action: `lesson.${decision}`,
      entityType: 'lesson',
      entityId: lesson.id,
      actor,
      details: {
        note: note || null,
        approvalState: lesson.approvalState
      }
    });

    this.persistAll();
    return lesson;
  }

  addEvaluation(evaluation, actor) {
    this.state.evaluations.push(evaluation);
    this.state.runtime.lastSuccessfulEvaluationAt = evaluation.completedAt;

    this.addAudit({
      action: 'evaluation.completed',
      entityType: 'evaluation',
      entityId: evaluation.id,
      actor,
      details: {
        score: evaluation.compositeScore,
        scenarioCount: evaluation.scenarioCount
      }
    });

    this.persistAll();
    return evaluation;
  }
}

module.exports = {
  DataStore
};
