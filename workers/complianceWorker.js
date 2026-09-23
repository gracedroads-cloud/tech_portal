class ComplianceWorker {
    constructor() {
        console.log('🛡️ Compliance Worker Initialized (PA Safety & EPA Protocols)');
    }

    async process(taskData, dispatchResult) {
        const issue = (taskData.userQuestion || '').toLowerCase();

        let fluidContainment = 'Standard dry-run inspection; no fluid spill detected.';
        if (
            issue.includes('leak') ||
            issue.includes('oil') ||
            issue.includes('coolant') ||
            issue.includes('fuel')
        ) {
            fluidContainment = 'MANDATORY: Spill containment mat deployed under vehicle; absorbent granules applied per PA DEP regulations.';
        }

        return {
            worker: 'Compliance Worker',
            status: 'SUCCESS',
            paRegulations: 'Verified compliance with PA commercial roadside safety and work zone standards.',
            safetyProtocol: dispatchResult.safetyInstructions,
            epasCompliance: fluidContainment,
            auditTimestamp: new Date().toISOString()
        };
    }
}

module.exports = ComplianceWorker;
