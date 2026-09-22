const POLICY_LABEL = 'NO TOWING and NO WINCHING';
const SUPPORTED_SERVICES = [
  'mobile_diagnostics',
  'roadside_mechanical_repair',
  'tire_service',
  'air_brake_triage',
  'battery_electrical_help'
];
const LOW_RISK_AUTO_DISPATCH_SERVICES = ['battery_electrical_help', 'tire_service'];
const POLICY_PATTERNS = [
  /\btow(?:ing|ed)?\b/i,
  /\bwinch(?:ing|ed)?\b/i,
  /\brecovery\b/i,
  /\bpull(?:[-\s]?out)?\b/i
];

function normalizeServiceType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function matchesUnsupportedPolicy(text) {
  return POLICY_PATTERNS.some((pattern) => pattern.test(String(text || '')));
}

function evaluatePolicy(candidate = {}) {
  const combined = [candidate.serviceType, candidate.requestedService, candidate.description, candidate.summary]
    .filter(Boolean)
    .join(' ');
  if (!matchesUnsupportedPolicy(combined)) {
    return null;
  }

  return {
    code: 'POLICY_REJECTED_NO_TOW_NO_WINCH',
    message: `${POLICY_LABEL} is enforced for this subsystem.`,
    referralProvider: candidate.referralProvider || 'Approved external provider referral required',
    policyLabel: POLICY_LABEL
  };
}

function isSupportedService(serviceType) {
  return SUPPORTED_SERVICES.includes(normalizeServiceType(serviceType));
}

function sanitizeRecommendedService(serviceType) {
  const normalized = normalizeServiceType(serviceType);
  if (isSupportedService(normalized)) {
    return normalized;
  }
  return 'mobile_diagnostics';
}

function applyPolicyToAiOutput(output = {}) {
  const rejection = evaluatePolicy(output);
  if (rejection) {
    return {
      ...output,
      recommendedServiceType: null,
      policyRejected: true,
      rejection,
      requiresHumanApproval: true,
      allowedActions: []
    };
  }

  return {
    ...output,
    recommendedServiceType: sanitizeRecommendedService(output.recommendedServiceType),
    requiresHumanApproval: output.requiresHumanApproval !== false,
    allowedActions: Array.isArray(output.allowedActions)
      ? output.allowedActions.filter((action) => action === 'draft_dispatch' || action === 'notify_teams')
      : []
  };
}

module.exports = {
  LOW_RISK_AUTO_DISPATCH_SERVICES,
  POLICY_LABEL,
  SUPPORTED_SERVICES,
  applyPolicyToAiOutput,
  evaluatePolicy,
  isSupportedService,
  matchesUnsupportedPolicy,
  normalizeServiceType,
  sanitizeRecommendedService
};
