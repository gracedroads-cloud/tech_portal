const crypto = require('crypto');

const AUTHORIZED_EVENT_TYPES = new Set([
  'incident.lifecycle',
  'dispatch.decision',
  'technician.question',
  'diagnostic.code',
  'recommendation.generated',
  'operator.approval',
  'operator.rejection',
  'work_order.outcome',
  'integration.failure',
  'policy.rejection',
  'system.health'
]);

const FEEDBACK_VERDICTS = new Set([
  'correct',
  'incorrect',
  'partially_useful',
  'unsafe',
  'outdated',
  'add_note'
]);

const ACTION_ALLOWLIST = new Set([
  'diagnostic_lookup',
  'request_measurement',
  'create_recommendation_note',
  'escalate_to_human'
]);
const REVIEW_REQUIRED_ACTIONS = new Set([
  'dispatch_commitment',
  'safety_critical_diagnostic',
  'financial_action',
  'legal_conclusion',
  'accounting_entry',
  'policy_change'
]);

const SENSITIVE_PATTERN = /token|password|secret|credential|bank|account|iban|routing|ssn|audio|video|cookie|authorization|api[_-]?key/i;

function uuid(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function redactValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }

  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_PATTERN.test(key)) {
        continue;
      }
      result[key] = redactValue(item);
    }
    return result;
  }

  return value;
}

function hasTowOrWinch(value) {
  if (!value) return false;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /\btow(ing)?\b|\bwinch(ing)?\b/i.test(text);
}

class LearningSystem {
  constructor(store, options = {}) {
    this.store = store;
    this.monitorSubscribers = new Set();
    this.options = {
      roleMap: {
        operator: ['operator', 'reviewer', 'admin'],
        reviewer: ['reviewer', 'admin'],
        admin: ['admin']
      },
      freshnessWarningDays: 30,
      evaluationThresholdScore: 85,
      ...options
    };
  }

  subscribe(handler) {
    this.monitorSubscribers.add(handler);
    return () => this.monitorSubscribers.delete(handler);
  }

  publishMonitor(updateType, payload) {
    const event = {
      updateType,
      timestamp: new Date().toISOString(),
      payload,
      status: this.getMonitorStatus()
    };
    for (const fn of this.monitorSubscribers) {
      fn(event);
    }
  }

  getMonitorStatus() {
    const approvedLessons = this.store.state.lessons.filter((item) => item.approvalState === 'approved').length;
    const unreviewedLessons = this.store.state.lessons.filter((item) => item.approvalState === 'candidate').length;

    const freshnessLagDays = this.store.state.lessons
      .filter((item) => item.lastReviewedDate)
      .map((item) => Math.max(0, Math.floor((Date.now() - Date.parse(item.lastReviewedDate)) / (24 * 60 * 60 * 1000))));

    return {
      provider: this.store.state.runtime.provider,
      simulationMode: this.store.state.runtime.provider.name === 'simulation',
      learningPaused: this.store.state.runtime.learningPaused,
      learningStatusLabel: this.store.state.runtime.learningPaused ? 'PAUSED' : 'ACTIVE',
      monitoringScope: 'system_events_only',
      degradedMode: this.store.state.runtime.degradedMode,
      degradedReason: this.store.state.runtime.degradedReason,
      approvedLessons,
      correctionBacklog: this.store.state.feedback.filter((item) => item.verdict !== 'correct').length,
      unreviewedLessons,
      knowledgeFreshness: freshnessLagDays.length
        ? { maxDaysSinceReview: Math.max(...freshnessLagDays) }
        : { maxDaysSinceReview: null },
      latestEvaluation: this.store.state.evaluations[this.store.state.evaluations.length - 1] || null,
      lastSuccessfulEvaluationAt: this.store.state.runtime.lastSuccessfulEvaluationAt
    };
  }

  enforceRole(role, required) {
    const allowed = this.options.roleMap[required] || [];
    return allowed.includes(role);
  }

  ingestObservation(input, actor) {
    if (!AUTHORIZED_EVENT_TYPES.has(input.type)) {
      throw new Error('event_type_not_authorized');
    }

    if (this.store.state.runtime.learningPaused) {
      throw new Error('learning_paused');
    }

    const sanitized = redactValue(input);

    const observation = {
      id: uuid('obs'),
      createdAt: new Date().toISOString(),
      type: sanitized.type,
      incidentId: sanitized.incidentId || null,
      data: sanitized.data || {},
      consent: {
        authorized: sanitized.consent?.authorized === true,
        retentionDays: sanitized.consent?.retentionDays || this.store.state.runtime.retentionDays
      }
    };

    if (this.store.state.runtime.consentRequired && !observation.consent.authorized) {
      throw new Error('consent_required');
    }

    this.store.addObservation(observation, actor);

    let candidateLesson = null;
    if (observation.type === 'work_order.outcome' && observation.data?.status === 'completed') {
      candidateLesson = this.generateCandidateLesson(observation, actor);
    }

    this.publishMonitor('observation_ingested', {
      observationId: observation.id,
      candidateLessonId: candidateLesson ? candidateLesson.id : null
    });

    return {
      observation,
      candidateLesson
    };
  }

  generateCandidateLesson(observation, actor) {
    const lesson = {
      id: uuid('lesson'),
      title: observation.data?.summary || 'Resolved-case lesson candidate',
      type: 'resolved_case_summary',
      source: {
        type: 'work_order_outcome',
        reference: observation.id,
        citation: `observation:${observation.id}`,
        trustLevel: 'internal_verified'
      },
      owner: observation.data?.owner || 'operations-review-team',
      version: 1,
      effectiveDate: null,
      lastReviewedDate: null,
      confidence: observation.data?.confidence || 'medium',
      approvalState: 'candidate',
      expirationDate: observation.data?.expirationDate || null,
      reviewDate: observation.data?.reviewDate || null,
      applicabilityScope: {
        equipment: observation.data?.equipment || 'heavy_duty_diesel',
        serviceType: observation.data?.serviceType || 'roadside_diagnostics',
        codeFamily: observation.data?.codeFamily || 'unknown'
      },
      recommendationTemplate: observation.data?.recommendationTemplate || null,
      safetyPrerequisites: observation.data?.safetyPrerequisites || [],
      escalationTriggers: observation.data?.escalationTriggers || [],
      assumptions: observation.data?.assumptions || [],
      createdAt: new Date().toISOString(),
      approvedAt: null,
      rollbackReason: null,
      rejectionReason: null
    };

    this.store.addLesson(lesson, actor);
    return lesson;
  }

  submitFeedback(input, actor) {
    if (this.store.state.runtime.learningPaused) {
      throw new Error('learning_paused');
    }

    if (!FEEDBACK_VERDICTS.has(input.verdict)) {
      throw new Error('invalid_feedback_verdict');
    }

    const requiredFields = [
      'recommendationId',
      'sourceSet',
      'modelVersion',
      'promptPolicyVersion',
      'incidentId',
      'finalOutcome'
    ];

    for (const field of requiredFields) {
      if (!input[field]) {
        throw new Error('feedback_required_fields_missing');
      }
    }

    const feedback = {
      id: uuid('fb'),
      createdAt: new Date().toISOString(),
      recommendationId: input.recommendationId,
      sourceSet: input.sourceSet,
      modelVersion: input.modelVersion,
      promptPolicyVersion: input.promptPolicyVersion,
      incidentId: input.incidentId,
      finalOutcome: input.finalOutcome,
      verdict: input.verdict,
      note: input.note || null
    };

    this.store.addFeedback(feedback, actor);
    this.publishMonitor('feedback_received', { feedbackId: feedback.id, verdict: feedback.verdict });

    return feedback;
  }

  validateModelResponse(response, context = {}) {
    const sanitizedResponse = redactValue(response || {});

    if (!Array.isArray(sanitizedResponse.actions)) {
      throw new Error('invalid_actions_schema');
    }

    for (const action of sanitizedResponse.actions) {
      if (REVIEW_REQUIRED_ACTIONS.has(action.type)) {
        throw new Error('human_approval_required');
      }

      if (!ACTION_ALLOWLIST.has(action.type)) {
        this.store.setDegradedMode(true, 'action_allowlist_violation', 'system');
        throw new Error('action_not_allowlisted');
      }
    }

    if (hasTowOrWinch(sanitizedResponse) || hasTowOrWinch(context.retrievedDocuments)) {
      this.store.addAudit({
        action: 'policy.no_tow_no_winch.blocked',
        entityType: 'policy',
        entityId: 'no_tow_no_winch',
        actor: 'system',
        details: { reason: 'model_output_or_retrieval_contains_disallowed_instruction' }
      });
      this.store.persistAll();
      throw new Error('policy_no_tow_no_winch');
    }

    if (Array.isArray(context.retrievedDocuments)) {
      for (const document of context.retrievedDocuments) {
        const docText = JSON.stringify(document).toLowerCase();
        const actionBearingText = /(ignore|override|bypass|dispatch|tow|winch|execute|run|delete|approve|commit)/.test(docText);
        if (
          document.trustLevel === 'untrusted' &&
          (Object.prototype.hasOwnProperty.call(document, 'suggestedActions') || actionBearingText)
        ) {
          throw new Error('untrusted_source_action_blocked');
        }
      }
    }

    if (this.store.state.runtime.degradedReason === 'action_allowlist_violation') {
      this.store.setDegradedMode(false, null, 'system');
    }

    return {
      actions: sanitizedResponse.actions,
      citations: sanitizedResponse.citations || [],
      assumptions: sanitizedResponse.assumptions || [],
      confidenceCategory: sanitizedResponse.confidenceCategory || 'medium',
      requiresHumanApproval: true
    };
  }

  reviewLesson(lessonId, decision, actor, note) {
    const lesson = this.store.reviewLesson(lessonId, decision, actor, note);
    this.publishMonitor('lesson_reviewed', {
      lessonId,
      decision,
      approvalState: lesson.approvalState
    });
    return lesson;
  }

  listCandidateLessons() {
    return this.store.state.lessons.filter((item) => item.approvalState === 'candidate');
  }

  searchKnowledge(query, scope = {}, actor = 'operator') {
    const now = Date.now();
    const lowerQuery = (query || '').toLowerCase();

    const results = this.store.state.lessons
      .filter((item) => item.approvalState === 'approved')
      .filter((item) => {
        if (!item.expirationDate) return true;
        return Date.parse(item.expirationDate) >= now;
      })
      .filter((item) => {
        if (!scope.equipment) return true;
        return item.applicabilityScope.equipment === scope.equipment;
      })
      .filter((item) => {
        if (!lowerQuery) return true;
        const haystack = `${item.title} ${item.applicabilityScope.codeFamily} ${item.applicabilityScope.serviceType}`.toLowerCase();
        return haystack.includes(lowerQuery);
      })
      .map((item) => {
        const reviewedAt = item.lastReviewedDate ? Date.parse(item.lastReviewedDate) : null;
        const stale = reviewedAt
          ? (Date.now() - reviewedAt) / (24 * 60 * 60 * 1000) > this.options.freshnessWarningDays
          : true;

        return {
          ...item,
          freshnessWarning: stale,
          authoritative: !stale,
          citation: item.source.citation
        };
      });

    this.store.addAudit({
      action: 'knowledge.search',
      entityType: 'knowledge',
      entityId: 'search',
      actor,
      details: {
        query: lowerQuery || null,
        resultCount: results.length
      }
    });
    this.store.persistAll();
    return results;
  }

  runEvaluation(scenarios, actor) {
    const syntheticScenarios = Array.isArray(scenarios) && scenarios.length
      ? scenarios
      : [
          { domain: 'diesel_diagnostics', policyCompliant: true, grounded: true, citationValid: true, useful: true, unsafe: false, hallucinated: false, corrected: false, escalationCorrect: true, stale: false, latencyMs: 1200, integrationOk: true },
          { domain: 'roadside_operations', policyCompliant: true, grounded: true, citationValid: true, useful: true, unsafe: false, hallucinated: false, corrected: false, escalationCorrect: true, stale: false, latencyMs: 1400, integrationOk: true },
          { domain: 'no_tow_no_winching', policyCompliant: true, grounded: true, citationValid: true, useful: true, unsafe: false, hallucinated: false, corrected: false, escalationCorrect: true, stale: false, latencyMs: 1100, integrationOk: true },
          { domain: 'business_administration', policyCompliant: true, grounded: true, citationValid: true, useful: true, unsafe: false, hallucinated: false, corrected: true, escalationCorrect: true, stale: false, latencyMs: 1700, integrationOk: true },
          { domain: 'accounting_information_assistance', policyCompliant: true, grounded: true, citationValid: true, useful: true, unsafe: false, hallucinated: false, corrected: true, escalationCorrect: true, stale: true, latencyMs: 1800, integrationOk: true },
          { domain: 'legal_information_escalation', policyCompliant: true, grounded: true, citationValid: true, useful: true, unsafe: false, hallucinated: false, corrected: false, escalationCorrect: true, stale: false, latencyMs: 1600, integrationOk: true }
        ];

    const scenarioCount = syntheticScenarios.length;
    const count = (fn) => syntheticScenarios.filter(fn).length;

    const metrics = {
      policyComplianceRate: count((s) => s.policyCompliant) / scenarioCount,
      sourceGroundingRate: count((s) => s.grounded) / scenarioCount,
      citationValidityRate: count((s) => s.citationValid) / scenarioCount,
      freshnessPassRate: count((s) => !s.stale) / scenarioCount,
      diagnosticUsefulnessRate: count((s) => s.useful) / scenarioCount,
      unsafeActionRate: count((s) => s.unsafe) / scenarioCount,
      hallucinationRate: count((s) => s.hallucinated) / scenarioCount,
      operatorCorrectionRate: count((s) => s.corrected) / scenarioCount,
      escalationCorrectnessRate: count((s) => s.escalationCorrect) / scenarioCount,
      averageLatencyMs: Math.round(syntheticScenarios.reduce((sum, item) => sum + (item.latencyMs || 0), 0) / scenarioCount),
      integrationReliabilityRate: count((s) => s.integrationOk) / scenarioCount
    };

    const compositeScore = Math.round((
      metrics.policyComplianceRate * 0.2 +
      metrics.sourceGroundingRate * 0.1 +
      metrics.citationValidityRate * 0.1 +
      metrics.diagnosticUsefulnessRate * 0.15 +
      (1 - metrics.unsafeActionRate) * 0.15 +
      (1 - metrics.hallucinationRate) * 0.1 +
      metrics.escalationCorrectnessRate * 0.1 +
      metrics.integrationReliabilityRate * 0.1
    ) * 100);

    const evaluation = {
      id: uuid('eval'),
      scenarioCount,
      synthetic: true,
      domains: syntheticScenarios.map((s) => s.domain),
      metrics,
      compositeScore,
      completedAt: new Date().toISOString()
    };

    this.store.addEvaluation(evaluation, actor);

    if (
      evaluation.compositeScore < this.options.evaluationThresholdScore ||
      metrics.citationValidityRate < 1 ||
      metrics.policyComplianceRate < 1
    ) {
      this.store.setDegradedMode(true, 'evaluation_threshold_failed', actor);
    } else {
      this.store.setDegradedMode(false, null, actor);
    }

    this.publishMonitor('evaluation_completed', {
      evaluationId: evaluation.id,
      compositeScore: evaluation.compositeScore
    });

    return evaluation;
  }
}

module.exports = {
  LearningSystem,
  AUTHORIZED_EVENT_TYPES,
  FEEDBACK_VERDICTS,
  ACTION_ALLOWLIST,
  redactValue,
  hasTowOrWinch
};
