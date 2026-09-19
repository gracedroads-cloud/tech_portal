const SERVICE_SCOPE_POLICY = {
  domain: 'heavy_duty_diesel_repair',
  allowedVehicleTypes: ['tractor-trailer', 'heavy-duty truck', 'heavy duty truck'],
  allowedServiceCategories: {
    diagnostics: { label: 'Diesel diagnostics', baseFee: 150 },
    air_brake_repair: { label: 'Air brake repair', baseFee: 250 },
    tire_service: { label: 'Commercial tire service', baseFee: 325 },
    electrical_repair: { label: 'Electrical repair', baseFee: 275 },
    coolant_fuel_system: { label: 'Coolant/Fuel system repair', baseFee: 300 },
    aftertreatment: { label: 'DPF/aftertreatment service', baseFee: 320 }
  },
  forbiddenKeywords: ['tow', 'towing', 'winch', 'winching', 'passenger vehicle', 'sedan', 'suv', 'motorcycle']
};

const APPROVED_FEE_SCHEDULE = {
  standard: 1,
  fleet: 0.95,
  priority: 1.2
};

const LABOR_TIERS = {
  standard: 150,
  emergency: 200
};

const MILEAGE_RATE = 3;

function validateScope({ serviceCategory, vehicleType, requestedWork = '', issueDescription = '' }) {
  const normalizedVehicleType = String(vehicleType || '').trim().toLowerCase();
  const normalizedText = `${requestedWork} ${issueDescription}`.toLowerCase();
  const reasons = [];

  if (!SERVICE_SCOPE_POLICY.allowedServiceCategories[serviceCategory]) {
    reasons.push('Service category is outside approved heavy-duty diesel repair scope.');
  }

  if (!SERVICE_SCOPE_POLICY.allowedVehicleTypes.includes(normalizedVehicleType)) {
    reasons.push('Vehicle type is outside heavy-duty service scope.');
  }

  if (SERVICE_SCOPE_POLICY.forbiddenKeywords.some((term) => normalizedText.includes(term))) {
    reasons.push('Requested work includes towing/winching/passenger-vehicle scope that is not permitted.');
  }

  return {
    approved: reasons.length === 0,
    reasons,
    policyDomain: SERVICE_SCOPE_POLICY.domain
  };
}

function generateEstimate({
  serviceCategory,
  laborTier = 'standard',
  laborHours = 1,
  mileage = 0,
  feeSchedule = 'standard'
}) {
  const service = SERVICE_SCOPE_POLICY.allowedServiceCategories[serviceCategory];
  if (!service) {
    throw new Error('Cannot estimate unapproved service category.');
  }

  const laborRate = LABOR_TIERS[laborTier];
  if (!laborRate) {
    throw new Error('Invalid labor tier.');
  }

  const scheduleMultiplier = APPROVED_FEE_SCHEDULE[feeSchedule];
  if (!scheduleMultiplier) {
    throw new Error('Invalid approved fee schedule.');
  }

  const safeLaborHours = Math.max(Number(laborHours) || 0, 0);
  const safeMileage = Math.max(Number(mileage) || 0, 0);

  const baseService = service.baseFee;
  const labor = laborRate * safeLaborHours;
  const travel = safeMileage * MILEAGE_RATE;
  const subtotal = baseService + labor + travel;
  const total = Number((subtotal * scheduleMultiplier).toFixed(2));

  return {
    serviceCategory,
    laborTier,
    laborHours: safeLaborHours,
    mileage: safeMileage,
    feeSchedule,
    breakdown: {
      baseService,
      labor,
      travel,
      subtotal,
      scheduleMultiplier
    },
    total
  };
}

module.exports = {
  SERVICE_SCOPE_POLICY,
  APPROVED_FEE_SCHEDULE,
  LABOR_TIERS,
  MILEAGE_RATE,
  validateScope,
  generateEstimate
};
