const { applyPolicyToAiOutput, matchesUnsupportedPolicy, sanitizeRecommendedService } = require('./policy');

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Grace AI timeout')), timeoutMs))
  ]);
}

function simulationDecision(incident) {
  const combined = `${incident.serviceType || ''} ${incident.description || ''}`;
  const towingLike = matchesUnsupportedPolicy(combined);
  const recommendedServiceType = towingLike
    ? null
    : sanitizeRecommendedService(incident.serviceType || 'mobile_diagnostics');

  return applyPolicyToAiOutput({
    provider: 'simulation',
    summary: towingLike
      ? 'Simulation flagged an unsupported towing/winching style request.'
      : `Simulation recommends ${recommendedServiceType.replace(/_/g, ' ')}.`,
    recommendedServiceType,
    priority: /brake|hazmat|fire/i.test(combined) ? 'high' : 'medium',
    requiresHumanApproval: true,
    allowedActions: towingLike ? ['notify_teams'] : ['draft_dispatch', 'notify_teams'],
    flags: towingLike ? ['policy_rejection'] : ['simulated_classification']
  });
}

function normalizeExternalDecision(payload = {}) {
  return applyPolicyToAiOutput({
    provider: 'external',
    summary: String(payload.summary || 'External Grace AI response received').slice(0, 500),
    recommendedServiceType: payload.recommendedServiceType,
    priority: ['low', 'medium', 'high', 'critical'].includes(payload.priority) ? payload.priority : 'medium',
    requiresHumanApproval: payload.requiresHumanApproval !== false,
    allowedActions: Array.isArray(payload.allowedActions) ? payload.allowedActions : [],
    flags: Array.isArray(payload.flags) ? payload.flags.map(String).slice(0, 10) : []
  });
}

function createGraceAiAdapter(config, logger) {
  return {
    async classifyIncident(incident) {
      if (!config.graceAiEndpoint || !config.graceAiApiKey) {
        return simulationDecision(incident);
      }

      const response = await withTimeout(fetch(config.graceAiEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: ['Bearer', config.graceAiApiKey].join(' ')
        },
        body: JSON.stringify({
          mode: 'isolated_ops_command',
          promptGuard: 'Respond only with structured JSON matching the schema.',
          toolsAllowed: ['draft_dispatch', 'notify_teams'],
          incident
        })
      }), config.outboundTimeoutMs);

      if (!response.ok) {
        throw new Error(`Grace AI endpoint returned ${response.status}`);
      }

      const body = await response.json();
      const decision = normalizeExternalDecision(body);
      logger('info', 'grace_ai.classified', { provider: 'external', flags: decision.flags });
      return decision;
    }
  };
}

module.exports = { createGraceAiAdapter, simulationDecision, normalizeExternalDecision };
