const fs = require('fs');
const path = require('path');

const STAGE_DEFINITIONS = [
    { id: 'answer', label: 'Call Answered', nextAction: 'Capture caller intake for heavy-duty diesel repair.' },
    { id: 'intake', label: 'Intake Captured', nextAction: 'Verify service scope and vehicle class.' },
    { id: 'scope_check', label: 'Scope Verified', nextAction: 'Confirm request fits heavy-duty diesel repair policy.' },
    { id: 'quote', label: 'Quote Ready', nextAction: 'Prepare estimate before payment link release.' },
    { id: 'payment_link', label: 'Payment Link Sent', nextAction: 'Send secure payment link without collecting card data.' },
    { id: 'technician_offer', label: 'Technician Offered', nextAction: 'Offer the job to an available Lehigh Valley technician.' },
    { id: 'technician_acceptance', label: 'Technician Accepted', nextAction: 'Technician acceptance is required before final dispatch action.' },
    { id: 'work_order', label: 'Work Order Created', nextAction: 'Create the work order only after technician acceptance.' },
    { id: 'closeout', label: 'Closeout Complete', nextAction: 'Capture work performed, proof, and completion details.' }
];

const BLOCKED_SCOPE_PATTERNS = [
    /tow/i,
    /towing/i,
    /winch/i,
    /winching/i,
    /light[\s-]?duty/i,
    /personal vehicle/i,
    /passenger vehicle/i
];

const REQUIRED_HEAVY_DUTY_PATTERNS = [
    /tractor[\s-]?trailer/i,
    /heavy[\s-]?duty/i,
    /class[\s-]?(7|8)/i,
    /commercial trailer/i,
    /heavy[\s-]?duty truck/i,
    /diesel/i
];

const SENSITIVE_PAYMENT_KEYS = [
    'card',
    'cardnumber',
    'card_number',
    'pan',
    'cvv',
    'cvc',
    'expiry',
    'exp',
    'routingnumber',
    'routing_number',
    'accountnumber',
    'account_number',
    'bankaccount'
];

function createStage(definition) {
    return {
        id: definition.id,
        label: definition.label,
        status: 'pending',
        time: null,
        nextAction: definition.nextAction,
        note: ''
    };
}

function createError(statusCode, message, details = {}) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.details = details;
    return error;
}

function createCallSkeleton(callId, payload = {}) {
    const stages = Object.fromEntries(STAGE_DEFINITIONS.map((definition) => [definition.id, createStage(definition)]));

    return {
        id: callId,
        callerName: payload.callerName || 'Keystone Freight',
        callerPhone: payload.callerPhone || '+1 610-555-0192',
        carrierName: payload.carrierName || payload.callerName || 'Keystone Freight',
        location: payload.location || 'I-78 Corridor (Easton, PA)',
        vehicleType: payload.vehicleType || 'tractor-trailer',
        serviceType: payload.serviceType || 'mobile diesel repair',
        overallStatus: 'active',
        nextAction: stages.answer.nextAction,
        stages,
        intake: {},
        scope: {},
        quote: null,
        payment: null,
        technician: {},
        workOrder: null,
        closeout: null,
        auditLog: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

class GraceDispatchStore {
    constructor({ dataDir, seedDemoCall = true } = {}) {
        this.calls = new Map();
        this.counter = 0;
        this.dataDir = dataDir;
        this.auditLogPath = dataDir ? path.join(dataDir, 'grace_dispatch_audit.log') : null;

        if (seedDemoCall) {
            this.seedDemoCall();
        }
    }

    seedDemoCall() {
        const call = this.answer({
            callerName: 'Keystone Freight',
            callerPhone: '+1 610-555-0192',
            carrierName: 'Keystone Freight',
            location: 'I-78 Corridor (Easton, PA)',
            vehicleType: 'tractor-trailer',
            serviceType: 'mobile diesel repair'
        });

        this.intake({
            callId: call.id,
            unitNumber: 'KF-204',
            symptoms: 'No-start after fuel delivery stop; needs heavy-duty diesel diagnostics.',
            callbackNumber: '+1 610-555-0192',
            requestedService: 'Mobile heavy-duty diesel repair'
        });

        this.scopeCheck({
            callId: call.id,
            vehicleType: 'tractor-trailer',
            requestedService: 'mobile diesel repair',
            issueSummary: 'No-start heavy-duty diesel repair on I-78'
        });

        this.quote({
            callId: call.id,
            urgency: 'standard',
            diagnosticsRequired: true,
            travelMiles: 18
        });

        this.paymentLink({
            callId: call.id,
            amount: 379,
            customerEmail: 'dispatch@keystonefreight.example'
        });

        this.technicianOffer({
            callId: call.id,
            technicianId: 'LV-TECH-07',
            technicianName: 'Lehigh Valley Mobile Unit 7'
        });
    }

    createCallId() {
        this.counter += 1;
        return `GRACE-${Date.now()}-${String(this.counter).padStart(3, '0')}`;
    }

    getCall(callId) {
        const call = this.calls.get(callId);
        if (!call) {
            throw createError(404, `Grace call ${callId} was not found.`);
        }
        return call;
    }

    touch(call) {
        call.updatedAt = new Date().toISOString();
    }

    log(call, eventType, details = {}) {
        const entry = {
            timestamp: new Date().toISOString(),
            callId: call.id,
            eventType,
            overallStatus: call.overallStatus,
            stage: details.stage || null,
            approvalGate: details.approvalGate || null,
            note: details.note || null,
            nextAction: call.nextAction
        };

        call.auditLog.push(entry);

        if (this.auditLogPath) {
            fs.appendFileSync(this.auditLogPath, `${JSON.stringify(entry)}\n`);
        }
    }

    setStage(call, stageId, status, overrides = {}) {
        const stage = call.stages[stageId];
        stage.status = status;
        stage.time = overrides.time || new Date().toISOString();
        stage.note = overrides.note !== undefined ? overrides.note : stage.note;
        stage.nextAction = overrides.nextAction !== undefined ? overrides.nextAction : stage.nextAction;
        this.touch(call);
    }

    activateStage(call, stageId, note, nextAction) {
        const stage = call.stages[stageId];
        this.setStage(call, stageId, 'active', {
            time: stage.time || new Date().toISOString(),
            note,
            nextAction
        });
    }

    updateOverallStatus(call, overallStatus, nextAction) {
        call.overallStatus = overallStatus;
        call.nextAction = nextAction;
        this.touch(call);
    }

    ensureStageComplete(call, stageId, message) {
        if (call.stages[stageId].status !== 'complete') {
            throw createError(409, message, {
                requiredStage: stageId,
                currentStatus: call.stages[stageId].status
            });
        }
    }

    ensureNotComplete(call) {
        if (call.overallStatus === 'complete') {
            throw createError(409, `Grace call ${call.id} is already complete.`);
        }
    }

    buildScopeDecision({ vehicleType = '', requestedService = '', issueSummary = '' }) {
        const combined = [vehicleType, requestedService, issueSummary].join(' ').trim();

        if (BLOCKED_SCOPE_PATTERNS.some((pattern) => pattern.test(combined))) {
            return {
                accepted: false,
                reason: 'Out of scope: towing, winching, light-duty, and personal-vehicle requests are blocked.'
            };
        }

        if (!REQUIRED_HEAVY_DUTY_PATTERNS.some((pattern) => pattern.test(combined))) {
            return {
                accepted: false,
                reason: 'Out of scope: Grace only supports Lehigh Valley heavy-duty diesel repair for tractor-trailers and heavy-duty trucks.'
            };
        }

        return {
            accepted: true,
            reason: 'Heavy-duty diesel repair request accepted for Grace dispatch flow.'
        };
    }

    answer(payload = {}) {
        const callId = payload.callId || this.createCallId();
        const call = createCallSkeleton(callId, payload);
        this.calls.set(callId, call);

        this.setStage(call, 'answer', 'complete', {
            note: 'Grace answered the inbound Lehigh Valley heavy-duty repair call.',
            nextAction: 'Capture caller intake for heavy-duty diesel repair.'
        });
        this.activateStage(call, 'intake', 'Awaiting caller intake.', 'Verify service scope and vehicle class.');
        this.updateOverallStatus(call, 'active', 'Capture intake details for the heavy-duty diesel request.');
        this.log(call, 'grace.call.started', {
            stage: 'answer',
            note: 'Inbound call answered.'
        });

        return call;
    }

    intake(payload = {}) {
        const call = this.getCall(payload.callId);
        this.ensureNotComplete(call);
        this.ensureStageComplete(call, 'answer', 'Grace must answer the call before intake can be captured.');

        call.intake = {
            unitNumber: payload.unitNumber || null,
            symptoms: payload.symptoms || null,
            callbackNumber: payload.callbackNumber || call.callerPhone,
            requestedService: payload.requestedService || call.serviceType
        };

        this.setStage(call, 'intake', 'complete', {
            note: 'Caller intake captured for heavy-duty diesel repair.',
            nextAction: 'Confirm request fits heavy-duty diesel repair policy.'
        });
        this.activateStage(call, 'scope_check', 'Scope review in progress.', 'Confirm request fits heavy-duty diesel repair policy.');
        this.updateOverallStatus(call, 'active', 'Run scope verification and block towing, winching, or light-duty requests.');
        this.log(call, 'grace.call.intake.received', {
            stage: 'intake',
            note: 'Intake captured.'
        });

        return call;
    }

    scopeCheck(payload = {}) {
        const call = this.getCall(payload.callId);
        this.ensureNotComplete(call);
        this.ensureStageComplete(call, 'intake', 'Intake must be complete before scope verification.');

        const decision = this.buildScopeDecision({
            vehicleType: payload.vehicleType || call.vehicleType,
            requestedService: payload.requestedService || call.intake.requestedService || call.serviceType,
            issueSummary: payload.issueSummary || call.intake.symptoms || ''
        });

        call.scope = {
            accepted: decision.accepted,
            reason: decision.reason
        };

        if (!decision.accepted) {
            this.setStage(call, 'scope_check', 'blocked', {
                note: decision.reason,
                nextAction: 'Refer the caller to an external towing or light-duty provider.'
            });
            this.updateOverallStatus(call, 'blocked', 'Out-of-scope request blocked. Provide external referral only.');
            this.log(call, 'grace.call.declined_out_of_scope', {
                stage: 'scope_check',
                approvalGate: 'scope_policy',
                note: decision.reason
            });
            return call;
        }

        this.setStage(call, 'scope_check', 'complete', {
            note: decision.reason,
            nextAction: 'Prepare estimate before payment link release.'
        });
        this.activateStage(call, 'quote', 'Estimate preparation in progress.', 'Prepare estimate before payment link release.');
        this.updateOverallStatus(call, 'active', 'Prepare a heavy-duty diesel estimate for the approved scope.');
        this.log(call, 'grace.call.scope.verified', {
            stage: 'scope_check',
            approvalGate: 'scope_policy',
            note: decision.reason
        });

        return call;
    }

    quote(payload = {}) {
        const call = this.getCall(payload.callId);
        this.ensureNotComplete(call);
        this.ensureStageComplete(call, 'scope_check', 'Scope verification must be complete before quoting.');

        const diagnosticsRequired = payload.diagnosticsRequired !== false;
        const dispatchBase = payload.urgency === 'emergency' ? 250 : 175;
        const laborMinimum = payload.urgency === 'emergency' ? 200 : 150;
        const diagnostics = diagnosticsRequired ? 150 : 0;
        const travel = Math.max(Number(payload.travelMiles || 0), 0) * 3;
        const total = dispatchBase + laborMinimum + diagnostics + travel;

        call.quote = {
            currency: 'USD',
            dispatchBase,
            laborMinimum,
            diagnostics,
            travel,
            total,
            disclaimer: 'Estimate only. Final dispatch remains gated on technician acceptance.'
        };

        this.setStage(call, 'quote', 'complete', {
            note: `Estimate prepared at $${total.toFixed(2)} for heavy-duty diesel roadside repair.`,
            nextAction: 'Send secure payment link without collecting card data.'
        });
        this.activateStage(call, 'payment_link', 'Secure payment link pending.', 'Send secure payment link without collecting card data.');
        this.updateOverallStatus(call, 'active', 'Send the secure payment link for the approved estimate.');
        this.log(call, 'grace.call.quote.created', {
            stage: 'quote',
            note: `Estimate total $${total.toFixed(2)}.`
        });

        return call;
    }

    paymentLink(payload = {}) {
        const call = this.getCall(payload.callId);
        this.ensureNotComplete(call);
        this.ensureStageComplete(call, 'quote', 'Quote must be complete before a payment link can be generated.');

        const receivedSensitiveFields = Object.keys(payload).filter((key) => SENSITIVE_PAYMENT_KEYS.includes(key.toLowerCase()));
        if (receivedSensitiveFields.length > 0) {
            throw createError(400, 'Raw card or bank data is not accepted. Use the secure payment link flow only.', {
                blockedFields: receivedSensitiveFields
            });
        }

        const reference = `PAY-${Date.now()}`;
        call.payment = {
            amount: Number(payload.amount || call.quote.total || 0),
            customerEmail: payload.customerEmail || null,
            paymentReference: reference,
            paymentLink: `https://payments.gracedroads.example/checkout/${reference}`,
            storedCardData: false
        };

        this.setStage(call, 'payment_link', 'complete', {
            note: 'Secure processor-hosted payment link generated; no card data stored locally.',
            nextAction: 'Offer the job to an available Lehigh Valley technician.'
        });
        this.activateStage(call, 'technician_offer', 'Technician offer pending.', 'Offer the job to an available Lehigh Valley technician.');
        this.updateOverallStatus(call, 'active', 'Send the approved job to a Lehigh Valley heavy-duty technician.');
        this.log(call, 'grace.call.payment.link.sent', {
            stage: 'payment_link',
            approvalGate: 'payment_link_only',
            note: 'Processor-hosted payment link issued.'
        });

        return call;
    }

    technicianOffer(payload = {}) {
        const call = this.getCall(payload.callId);
        this.ensureNotComplete(call);
        this.ensureStageComplete(call, 'payment_link', 'Payment link must be generated before a technician offer can be sent.');

        call.technician = {
            technicianId: payload.technicianId || 'LV-TECH-01',
            technicianName: payload.technicianName || 'Lehigh Valley Mobile Unit 1',
            accepted: false,
            acceptedAt: null
        };

        this.setStage(call, 'technician_offer', 'complete', {
            note: `Offer sent to ${call.technician.technicianName}.`,
            nextAction: 'Technician acceptance is required before final dispatch action.'
        });
        this.activateStage(call, 'technician_acceptance', 'Awaiting technician acceptance.', 'Technician acceptance is required before final dispatch action.');
        this.updateOverallStatus(call, 'ready', 'Wait for technician acceptance before creating the work order.');
        this.log(call, 'grace.call.tech.offered', {
            stage: 'technician_offer',
            approvalGate: 'technician_offer',
            note: `Offer sent to ${call.technician.technicianName}.`
        });

        return call;
    }

    technicianAcceptance(payload = {}) {
        const call = this.getCall(payload.callId);
        this.ensureNotComplete(call);
        this.ensureStageComplete(call, 'technician_offer', 'A technician must be offered the job before acceptance can be recorded.');

        if (!payload.accepted) {
            throw createError(409, 'Final dispatch remains blocked until a technician explicitly accepts the job.', {
                approvalGate: 'technician_acceptance'
            });
        }

        call.technician.accepted = true;
        call.technician.acceptedAt = new Date().toISOString();

        this.setStage(call, 'technician_acceptance', 'complete', {
            note: `${call.technician.technicianName || 'Assigned technician'} accepted the dispatch.`,
            nextAction: 'Create the work order and final dispatch record.'
        });
        this.activateStage(call, 'work_order', 'Work order creation pending.', 'Create the work order and final dispatch record.');
        this.updateOverallStatus(call, 'active', 'Technician accepted. Create the work order to confirm dispatch.');
        this.log(call, 'grace.call.tech.accepted', {
            stage: 'technician_acceptance',
            approvalGate: 'technician_acceptance',
            note: 'Technician acceptance recorded.'
        });

        return call;
    }

    workOrder(payload = {}) {
        const call = this.getCall(payload.callId);
        this.ensureNotComplete(call);
        this.ensureStageComplete(call, 'technician_acceptance', 'Final dispatch is not actionable until technician acceptance is complete.');

        call.workOrder = {
            workOrderId: payload.workOrderId || `WO-${Date.now()}`,
            finalDispatchActionable: true,
            technicianAccepted: true
        };

        this.setStage(call, 'work_order', 'complete', {
            note: `${call.workOrder.workOrderId} created after technician acceptance.`,
            nextAction: 'Capture closeout details when the repair is complete.'
        });
        this.activateStage(call, 'closeout', 'Repair in progress; closeout pending.', 'Capture closeout details when the repair is complete.');
        this.updateOverallStatus(call, 'active', 'Repair is active. Collect closeout proof and completion details.');
        this.log(call, 'grace.call.work_order.created', {
            stage: 'work_order',
            approvalGate: 'dispatch_confirmation',
            note: `${call.workOrder.workOrderId} created after technician acceptance.`
        });

        return call;
    }

    closeout(payload = {}) {
        const call = this.getCall(payload.callId);
        this.ensureNotComplete(call);
        this.ensureStageComplete(call, 'work_order', 'A work order must exist before closeout can be completed.');

        call.closeout = {
            diagnostics: payload.diagnostics || null,
            workPerformed: payload.workPerformed || null,
            partsUsed: Array.isArray(payload.partsUsed) ? payload.partsUsed : [],
            laborMinutes: Number(payload.laborMinutes || 0),
            customerSignature: payload.customerSignature || null,
            proofPhotos: Array.isArray(payload.proofPhotos) ? payload.proofPhotos : [],
            completionGps: payload.completionGps || null
        };

        this.setStage(call, 'closeout', 'complete', {
            note: 'Closeout captured with work summary and completion proof.',
            nextAction: 'Grace lifecycle complete.'
        });
        this.updateOverallStatus(call, 'complete', 'Grace lifecycle complete.');
        this.log(call, 'grace.call.closedout', {
            stage: 'closeout',
            approvalGate: 'closeout',
            note: 'Call lifecycle completed.'
        });

        return call;
    }

    getSummary() {
        const summary = {
            ready: 0,
            active: 0,
            blocked: 0,
            complete: 0
        };

        for (const call of this.calls.values()) {
            if (summary[call.overallStatus] !== undefined) {
                summary[call.overallStatus] += 1;
            }
        }

        return summary;
    }

    serializeCall(call) {
        return {
            id: call.id,
            callerName: call.callerName,
            callerPhone: call.callerPhone,
            carrierName: call.carrierName,
            location: call.location,
            vehicleType: call.vehicleType,
            serviceType: call.serviceType,
            overallStatus: call.overallStatus,
            nextAction: call.nextAction,
            createdAt: call.createdAt,
            updatedAt: call.updatedAt,
            quote: call.quote,
            payment: call.payment,
            technician: call.technician,
            workOrder: call.workOrder,
            closeout: call.closeout,
            auditLog: call.auditLog,
            stages: STAGE_DEFINITIONS.map((definition) => call.stages[definition.id])
        };
    }

    getActiveCalls() {
        return Array.from(this.calls.values())
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .map((call) => this.serializeCall(call));
    }
}

module.exports = {
    GraceDispatchStore,
    STAGE_DEFINITIONS,
    createError
};
