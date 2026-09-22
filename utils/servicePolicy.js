const PROHIBITED_SERVICE_PATTERN = /\b(tow(?:ing|ed)?|winch(?:ing|ed)?|vehicle recovery|heavy recovery|off[- ]road recovery)\b/i;

class ServicePolicyError extends Error {
    constructor() {
        super('EH Graced Roads Solutions LLC does not provide towing, winching, or vehicle-recovery services.');
        this.name = 'ServicePolicyError';
        this.status = 422;
    }
}

function assertPermittedService(...values) {
    const requestText = values.filter(value => typeof value === 'string').join(' ');
    if (PROHIBITED_SERVICE_PATTERN.test(requestText)) {
        throw new ServicePolicyError();
    }
}

module.exports = { assertPermittedService, ServicePolicyError };
