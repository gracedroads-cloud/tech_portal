const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const LEHIGH_VALLEY_BASE = {
    name: 'Lehigh Valley, PA',
    lat: 40.6259,
    lng: -75.3705
};
const DEFAULT_RADIUS_MILES = Number(process.env.WATCH_CENTER_RADIUS_MILES || 150);
const WATCH_CENTER_STALE_MS = Number(process.env.WATCH_CENTER_STALE_MS || 5 * 60 * 1000);

const RATE_CARD = {
    serviceCall: Number(process.env.RATE_SERVICE_CALL || 245),
    laborTiers: {
        standard: Number(process.env.RATE_LABOR_STANDARD || 165),
        urgent: Number(process.env.RATE_LABOR_URGENT || 210),
        severe: Number(process.env.RATE_LABOR_SEVERE || 265)
    },
    includedMiles: Number(process.env.RATE_INCLUDED_MILES || 20),
    travelPerMile: Number(process.env.RATE_TRAVEL_PER_MILE || 4.5)
};

const blockedScopeTerms = ['tow', 'towing', 'winch', 'winching', 'recovery', 'passenger', 'light-duty', 'light duty'];
const restrictedPaymentFields = ['cardnumber', 'cvv', 'cvc', 'expiry', 'exp', 'routingnumber', 'accountnumber'];
const safeNamePattern = /^[a-zA-Z0-9 .,'-]{0,120}$/;
const safeContactPattern = /^[a-zA-Z0-9@+().\-_\s]{0,180}$/;

const callControl = {
    mode: 'grace_ai',
    updatedAt: new Date().toISOString()
};

const watchCenterState = {
    gps: null,
    radiusMiles: DEFAULT_RADIUS_MILES
};

const graceCalls = new Map();
const requestRateState = new Map();
const dvirRecords = [];
const departmentSuggestions = [];

const companyDepartments = [
    {
        id: 'hr',
        name: 'EH Graced Roads HR Department',
        focus: 'Hiring, employee support, culture, and workforce policies.'
    },
    {
        id: 'legal',
        name: 'EH Graced Roads Legal Department',
        focus: 'Contracts, compliance, risk management, and legal guidance.'
    },
    {
        id: 'marketing',
        name: 'EH Graced Roads Marketing Department',
        focus: 'Brand growth, outreach campaigns, and public messaging.'
    },
    {
        id: 'qa_suggestions',
        name: 'EH Graced Roads Question and Answer & Suggestions Department',
        focus: 'Internal Q&A intake and improvement suggestions from team/community.'
    },
    {
        id: 'leadership_development',
        name: 'EH Graced Roads Leadership and Development Department',
        focus: 'Leadership training, mentorship, and professional development paths.'
    },
    {
        id: 'uplift_environment',
        name: 'EH Graced Roads Uplift the Environment Department',
        focus: 'Environmental stewardship initiatives and sustainable operations.'
    },
    {
        id: 'military_veterans',
        name: 'EH Graced Roads Support of Military Veterans Department',
        focus: 'Veteran support programs, recruiting, and transition resources.'
    },
    {
        id: 'community_donation',
        name: 'EH Graced Roads Community Donation Department',
        focus: 'Community donation planning, events, and local partnerships.'
    },
    {
        id: 'youth_sponsorship',
        name: 'EH Graced Roads Youth Athletic and Academic Sponsorship Department',
        focus: 'Youth sports and academic sponsorship initiatives.'
    }
];

const demoBreakdowns = [
    {
        id: 'BD-401',
        vehicle: 'Freightliner Cascadia',
        issue: 'Fuel delivery fault',
        severity: 'HIGH',
        lat: 40.712,
        lng: -75.495,
        location: 'US-22 near Allentown, PA'
    },
    {
        id: 'BD-402',
        vehicle: 'Kenworth T680',
        issue: 'Air brake pressure loss',
        severity: 'CRITICAL',
        lat: 40.231,
        lng: -75.166,
        location: 'PA Turnpike near Lansdale, PA'
    },
    {
        id: 'BD-403',
        vehicle: 'Volvo VNL 760',
        issue: 'DEF derate active',
        severity: 'MEDIUM',
        lat: 41.103,
        lng: -75.32,
        location: 'I-80 near Stroudsburg, PA'
    },
    {
        id: 'BD-404',
        vehicle: 'Peterbilt 579',
        issue: 'Starter no-crank',
        severity: 'MEDIUM',
        lat: 39.915,
        lng: -75.41,
        location: 'I-476 near Chester, PA'
    },
    {
        id: 'BD-405',
        vehicle: 'Mack Anthem',
        issue: 'Cooling fan clutch failure',
        severity: 'HIGH',
        lat: 42.01,
        lng: -74.89,
        location: 'NY-17 near Liberty, NY'
    }
];

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => {
    res.redirect('/index.html');
});

function nowIso() {
    return new Date().toISOString();
}

function sanitizeCallId(callId) {
    return String(callId || '').trim();
}

function isValidCoordinate(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const earthRadiusMiles = 3958.8;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMiles * c;
}

function isGpsStale(gps) {
    if (!gps || !gps.updatedAt) {
        return true;
    }
    return Date.now() - new Date(gps.updatedAt).getTime() > WATCH_CENTER_STALE_MS;
}

function getActiveWatchCenter() {
    const stale = isGpsStale(watchCenterState.gps);
    const active = !stale && watchCenterState.gps
        ? {
            sourceMode: 'live_gps',
            lat: watchCenterState.gps.lat,
            lng: watchCenterState.gps.lng,
            lastUpdate: watchCenterState.gps.updatedAt,
            stale: false,
            label: 'Live GPS'
        }
        : {
            sourceMode: 'fallback_lehigh_valley',
            lat: LEHIGH_VALLEY_BASE.lat,
            lng: LEHIGH_VALLEY_BASE.lng,
            lastUpdate: watchCenterState.gps ? watchCenterState.gps.updatedAt : null,
            stale,
            label: LEHIGH_VALLEY_BASE.name
        };

    return {
        radiusMiles: watchCenterState.radiusMiles,
        center: {
            lat: active.lat,
            lng: active.lng,
            label: active.label
        },
        sourceMode: active.sourceMode,
        lastUpdate: active.lastUpdate,
        freshness: active.stale ? 'stale' : 'fresh',
        stale: active.stale
    };
}

function containsDisallowedPaymentFields(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const stack = [value];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== 'object') {
            continue;
        }

        for (const [key, entry] of Object.entries(current)) {
            const normalizedKey = String(key).toLowerCase().replace(/[^a-z]/g, '');
            if (restrictedPaymentFields.includes(normalizedKey)) {
                return true;
            }

            if (entry && typeof entry === 'object') {
                stack.push(entry);
            }
        }
    }

    return false;
}

function validateServiceScope(scopeInput = {}) {
    const rawVehicleType = String(scopeInput.vehicleType || '').toLowerCase();
    const rawServiceType = String(scopeInput.serviceType || '').toLowerCase();
    const rawIssue = String(scopeInput.issue || '').toLowerCase();
    const requestedServices = Array.isArray(scopeInput.requestedServices)
        ? scopeInput.requestedServices.map((entry) => String(entry).toLowerCase())
        : [];

    const combined = [rawVehicleType, rawServiceType, rawIssue, requestedServices.join(' ')].join(' ');
    const blockedReason = blockedScopeTerms.find((term) => combined.includes(term));

    if (blockedReason) {
        return {
            accepted: false,
            reason: `Out-of-scope request (${blockedReason}) is not allowed.`,
            policy: 'heavy_duty_mobile_diesel_only_no_tow_no_winch'
        };
    }

    const heavyDutyVehicle =
        rawVehicleType.includes('tractor-trailer') ||
        rawVehicleType.includes('tractor trailer') ||
        rawVehicleType.includes('heavy-duty') ||
        rawVehicleType.includes('heavy duty') ||
        rawVehicleType.includes('semi') ||
        rawVehicleType.includes('class 8') ||
        rawVehicleType.includes('heavy-duty truck') ||
        rawVehicleType.includes('heavy duty truck');

    const mobileDieselScope =
        rawServiceType.includes('mobile diesel repair') ||
        rawServiceType.includes('diesel repair') ||
        rawServiceType.includes('roadside diesel') ||
        rawServiceType.includes('mobile repair');

    if (!heavyDutyVehicle || !mobileDieselScope) {
        return {
            accepted: false,
            reason: 'Only mobile diesel repair for tractor-trailers and heavy-duty trucks is in scope.',
            policy: 'heavy_duty_mobile_diesel_only_no_tow_no_winch'
        };
    }

    return {
        accepted: true,
        reason: 'Scope verified for heavy-duty mobile diesel repair.',
        policy: 'heavy_duty_mobile_diesel_only_no_tow_no_winch'
    };
}

function getDispatchStatus(call) {
    if (call.workOrder) {
        return 'dispatch_confirmed';
    }
    if (call.technicianOffer && !call.technicianAccepted) {
        return 'pending_technician_acceptance';
    }
    if (call.quote) {
        return 'estimate';
    }
    return 'estimate';
}

function transitionCall(call, nextState, action, detail = {}) {
    const previousState = call.lifecycleState;
    call.lifecycleState = nextState;
    call.updatedAt = nowIso();
    call.auditLog.push({
        timestamp: call.updatedAt,
        action,
        from: previousState,
        to: nextState,
        detail
    });
}

function buildLifecycleProgress(call) {
    return {
        answeredAt: call.answeredAt || null,
        intakeAt: call.intakeAt || null,
        scopeVerifiedAt: call.scopeCheckedAt || null,
        quoteReadyAt: call.quoteAt || null,
        paymentLinkSentAt: call.paymentLinkAt || null,
        technicianOfferedAt: call.technicianOfferAt || null,
        technicianAcceptedAt: call.technicianAcceptedAt || null,
        workOrderCreatedAt: call.workOrderAt || null,
        closeoutCompleteAt: call.closeoutAt || null
    };
}

function toCallResponse(call) {
    return {
        callId: call.callId,
        lifecycleState: call.lifecycleState,
        dispatchStatus: getDispatchStatus(call),
        technicianAccepted: call.technicianAccepted,
        scope: call.scope,
        estimate: call.quote,
        payment: call.payment,
        technicianOffer: call.technicianOffer,
        workOrder: call.workOrder,
        closeout: call.closeout,
        lifecycleProgress: buildLifecycleProgress(call),
        auditLog: call.auditLog,
        updatedAt: call.updatedAt,
        createdAt: call.createdAt
    };
}

function getOrCreateCall(callId) {
    const sanitized = sanitizeCallId(callId) || `CALL-${Date.now()}`;
    if (!graceCalls.has(sanitized)) {
        const createdAt = nowIso();
        graceCalls.set(sanitized, {
            callId: sanitized,
            lifecycleState: 'new',
            createdAt,
            updatedAt: createdAt,
            auditLog: [],
            technicianAccepted: false
        });
    }

    return graceCalls.get(sanitized);
}

function getCallOr404(req, res) {
    const requestBody = req.body || {};
    const callId = sanitizeCallId(requestBody.callId || req.params.callId);
    if (!callId || !graceCalls.has(callId)) {
        res.status(404).json({ error: 'Call not found', callId });
        return null;
    }
    return graceCalls.get(callId);
}

function buildEstimate({ laborTier = 'standard', laborHours = 1, travelMiles = 0 }) {
    const tier = RATE_CARD.laborTiers[laborTier] ? laborTier : 'standard';
    const hours = Number.isFinite(Number(laborHours)) ? Math.max(0.5, Number(laborHours)) : 1;
    const miles = Number.isFinite(Number(travelMiles)) ? Math.max(0, Number(travelMiles)) : 0;
    const billableTravelMiles = Math.max(0, miles - RATE_CARD.includedMiles);

    const serviceCall = RATE_CARD.serviceCall;
    const labor = Number((RATE_CARD.laborTiers[tier] * hours).toFixed(2));
    const travel = Number((billableTravelMiles * RATE_CARD.travelPerMile).toFixed(2));
    const totalEstimate = Number((serviceCall + labor + travel).toFixed(2));

    return {
        label: 'estimate_not_final',
        currency: 'USD',
        serviceCall,
        laborTier: tier,
        laborHours: hours,
        laborRate: RATE_CARD.laborTiers[tier],
        laborSubtotal: labor,
        travelMiles: miles,
        travelChargeableMiles: billableTravelMiles,
        travelRate: RATE_CARD.travelPerMile,
        travelSubtotal: travel,
        totalEstimate,
        disclaimer: 'Estimate only. Final invoice may vary based on confirmed diagnostics and approved scope.'
    };
}

function ensureTowWinchNotOffered(payload = {}) {
    const offeredText = [
        payload.serviceType,
        payload.offerType,
        payload.workOrderType,
        payload.notes
    ]
        .map((entry) => String(entry || '').toLowerCase())
        .join(' ');

    if (blockedScopeTerms.some((term) => offeredText.includes(term))) {
        return false;
    }

    return true;
}

function resetInMemoryState() {
    graceCalls.clear();
    watchCenterState.gps = null;
    watchCenterState.radiusMiles = DEFAULT_RADIUS_MILES;
    callControl.mode = 'grace_ai';
    callControl.updatedAt = nowIso();
    requestRateState.clear();
    dvirRecords.length = 0;
    departmentSuggestions.length = 0;
}

function createRateLimiter({ windowMs, maxRequests }) {
    return (req, res, next) => {
        const key = `${req.path}:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
        const now = Date.now();
        const existing = requestRateState.get(key);

        if (!existing || now > existing.resetAt) {
            requestRateState.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        if (existing.count >= maxRequests) {
            return res.status(429).json({
                error: 'Too many requests, please retry shortly.'
            });
        }

        existing.count += 1;
        requestRateState.set(key, existing);
        return next();
    };
}

// DVIR API Endpoint
app.post('/api/dvir', createRateLimiter({ windowMs: 60 * 1000, maxRequests: 20 }), (req, res) => {
    try {
        const dvirData = req.body;
        const id = `dvir_${Date.now()}`;
        dvirRecords.push({
            id,
            createdAt: nowIso(),
            payload: dvirData
        });
        res.status(200).json({ success: true, message: 'DVIR record saved successfully', id });
    } catch (error) {
        console.error('Error saving DVIR:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// System Status / Breakdown Ticker Endpoint
app.get('/api/status', (req, res) => {
    res.json({
        status: 'ONLINE',
        base: LEHIGH_VALLEY_BASE.name,
        port: PORT,
        timestamp: nowIso(),
        callControl
    });
});

app.get('/api/watch-center', (req, res) => {
    const watchCenter = getActiveWatchCenter();
    res.json(watchCenter);
});

app.get('/api/departments', (_req, res) => {
    res.json({
        departments: companyDepartments,
        totalDepartments: companyDepartments.length
    });
});

app.post('/api/departments/qa-suggestions', createRateLimiter({ windowMs: 5 * 60 * 1000, maxRequests: 8 }), (req, res) => {
    const fromName = String(req.body.fromName || '').trim();
    const contact = String(req.body.contact || '').trim();
    const message = String(req.body.message || '').trim();
    const category = String(req.body.category || 'suggestion').trim().toLowerCase();

    if (!message || message.length < 5 || message.length > 1200) {
        return res.status(400).json({
            error: 'A message between 5 and 1200 characters is required.'
        });
    }

    if (fromName && !safeNamePattern.test(fromName)) {
        return res.status(400).json({
            error: 'Name contains unsupported characters.'
        });
    }

    if (contact && !safeContactPattern.test(contact)) {
        return res.status(400).json({
            error: 'Contact field contains unsupported characters.'
        });
    }

    const safeEntry = {
        id: `qa_${Date.now()}`,
        departmentId: 'qa_suggestions',
        fromName: fromName ? fromName.slice(0, 120) : 'Anonymous',
        contact: contact ? contact.slice(0, 180) : null,
        category: ['question', 'suggestion'].includes(category) ? category : 'suggestion',
        message: message.slice(0, 3000),
        createdAt: nowIso()
    };

    departmentSuggestions.push(safeEntry);

    return res.status(201).json({
        message: 'Submission received by EH Graced Roads Question and Answer & Suggestions Department.',
        submission: safeEntry
    });
});

app.get('/api/departments/qa-suggestions', (_req, res) => {
    res.json({
        totalSubmissions: departmentSuggestions.length,
        submissions: departmentSuggestions.slice(-25).reverse()
    });
});

app.post('/api/watch-center/location', (req, res) => {
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    if (!isValidCoordinate(lat, lng)) {
        return res.status(400).json({
            error: 'Invalid coordinates',
            accepted: false,
            details: 'Latitude must be between -90 and 90 and longitude between -180 and 180.'
        });
    }

    watchCenterState.gps = {
        lat,
        lng,
        updatedAt: nowIso()
    };

    return res.json({ accepted: true, watchCenter: getActiveWatchCenter() });
});

app.get('/api/breakdowns/scanner', (req, res) => {
    const watchCenter = getActiveWatchCenter();
    const radiusMiles = Number.isFinite(Number(req.query.radius))
        ? Math.max(1, Number(req.query.radius))
        : watchCenter.radiusMiles;

    const breakdowns = demoBreakdowns
        .map((item) => {
            const distanceMiles = haversineMiles(watchCenter.center.lat, watchCenter.center.lng, item.lat, item.lng);
            return {
                ...item,
                distanceMiles,
                distance: `${distanceMiles.toFixed(1)} mi`
            };
        })
        .filter((item) => item.distanceMiles <= radiusMiles)
        .sort((a, b) => a.distanceMiles - b.distanceMiles)
        .map(({ lat, lng, ...safeItem }) => safeItem);

    res.json({
        watchCenter,
        radiusMiles,
        breakdowns
    });
});

app.post('/api/stream/override', (req, res) => {
    const action = String(req.body.action || '').toLowerCase();
    if (action === 'pickup') {
        callControl.mode = 'human_override';
    } else if (action === 'resume_grace') {
        callControl.mode = 'grace_ai';
    } else {
        return res.status(400).json({
            success: false,
            error: 'Unsupported stream override action. Use pickup or resume_grace.'
        });
    }

    callControl.updatedAt = nowIso();

    return res.json({
        success: true,
        callControl,
        message: 'Call-control status updated. No phone system action executed in this compatibility mode.'
    });
});

app.post('/api/grace/call/answer', (req, res) => {
    const call = getOrCreateCall(req.body.callId);
    call.caller = {
        fleetName: req.body.fleetName || null,
        callbackNumber: req.body.callbackNumber || null,
        answeredBy: req.body.answeredBy || 'grace_ai'
    };
    call.answeredAt = nowIso();
    transitionCall(call, 'answered', 'call_answered', { answeredBy: call.caller.answeredBy });

    return res.status(201).json({
        message: 'Call answered',
        ...toCallResponse(call)
    });
});

app.post('/api/grace/call/intake', (req, res) => {
    const call = getCallOr404(req, res);
    if (!call) {
        return;
    }

    call.intake = {
        location: req.body.location || null,
        unitNumber: req.body.unitNumber || null,
        issue: req.body.issue || null,
        vehicleType: req.body.vehicleType || null,
        serviceType: req.body.serviceType || null,
        capturedAt: nowIso()
    };
    call.intakeAt = call.intake.capturedAt;
    transitionCall(call, 'intake_captured', 'intake_captured', { unitNumber: call.intake.unitNumber });

    return res.json({
        message: 'Intake captured',
        ...toCallResponse(call)
    });
});

app.post('/api/grace/call/scope-check', (req, res) => {
    const call = getCallOr404(req, res);
    if (!call) {
        return;
    }

    const scopeInput = {
        vehicleType: req.body.vehicleType || call.intake?.vehicleType,
        serviceType: req.body.serviceType || call.intake?.serviceType,
        issue: req.body.issue || call.intake?.issue,
        requestedServices: req.body.requestedServices
    };

    const scopeResult = validateServiceScope(scopeInput);
    call.scope = {
        ...scopeInput,
        ...scopeResult,
        checkedAt: nowIso()
    };
    call.scopeCheckedAt = call.scope.checkedAt;

    transitionCall(
        call,
        scopeResult.accepted ? 'scope_verified' : 'scope_blocked',
        'scope_checked',
        { accepted: scopeResult.accepted, reason: scopeResult.reason }
    );

    if (!scopeResult.accepted) {
        return res.status(422).json({
            message: 'Scope rejected',
            dispatchStatus: 'estimate',
            ...toCallResponse(call)
        });
    }

    return res.json({
        message: 'Scope verified',
        dispatchStatus: 'estimate',
        ...toCallResponse(call)
    });
});

app.post('/api/grace/call/quote', (req, res) => {
    const call = getCallOr404(req, res);
    if (!call) {
        return;
    }

    if (call.lifecycleState === 'scope_blocked' || call.scope?.accepted === false) {
        return res.status(422).json({
            error: 'Out-of-scope requests cannot generate quotes.',
            dispatchStatus: 'estimate',
            ...toCallResponse(call)
        });
    }

    if (!call.scope?.accepted) {
        return res.status(409).json({
            error: 'Scope must be verified before quote generation.',
            dispatchStatus: 'estimate',
            ...toCallResponse(call)
        });
    }

    call.quote = {
        ...buildEstimate(req.body),
        generatedAt: nowIso()
    };
    call.quoteAt = call.quote.generatedAt;
    transitionCall(call, 'quote_ready', 'quote_generated', { totalEstimate: call.quote.totalEstimate });

    return res.json({
        message: 'Estimate generated',
        dispatchStatus: 'estimate',
        ...toCallResponse(call)
    });
});

app.post('/api/grace/call/payment-link', (req, res) => {
    if (containsDisallowedPaymentFields(req.body)) {
        return res.status(400).json({
            error: 'Raw payment credentials are not accepted. Use secure processor handoff only.',
            rejected: true
        });
    }

    const call = getCallOr404(req, res);
    if (!call) {
        return;
    }

    if (!call.quote) {
        return res.status(409).json({
            error: 'Estimate must be prepared before sending payment link.',
            dispatchStatus: 'estimate',
            ...toCallResponse(call)
        });
    }

    const providerBaseUrl = process.env.PAYMENT_PROVIDER_URL;
    const mode = providerBaseUrl ? 'processor_handoff' : 'mock_processor_handoff';
    const linkBase = providerBaseUrl || `https://mock-payments.gracedroads.local/handoff`;

    call.payment = {
        mode,
        label: mode === 'mock_processor_handoff'
            ? 'Mock secure processor handoff (demo only)'
            : 'Secure processor handoff',
        paymentLink: `${linkBase}?callId=${encodeURIComponent(call.callId)}&ts=${Date.now()}`,
        sentTo: req.body.sendTo || null,
        sentAt: nowIso()
    };
    call.paymentLinkAt = call.payment.sentAt;
    transitionCall(call, 'payment_link_sent', 'payment_link_sent', { mode: call.payment.mode });

    return res.json({
        message: 'Payment link generated',
        dispatchStatus: 'estimate',
        ...toCallResponse(call)
    });
});

app.post('/api/grace/call/technician-offer', (req, res) => {
    const call = getCallOr404(req, res);
    if (!call) {
        return;
    }

    if (!call.scope?.accepted || !call.quote || !call.payment) {
        return res.status(409).json({
            error: 'Scope verification, quote, and payment link are required before technician offer.',
            dispatchStatus: getDispatchStatus(call),
            ...toCallResponse(call)
        });
    }

    if (!ensureTowWinchNotOffered(req.body)) {
        return res.status(422).json({
            error: 'Towing, winching, and recovery services cannot be offered by Grace dispatch endpoints.',
            dispatchStatus: 'estimate',
            ...toCallResponse(call)
        });
    }

    call.technicianOffer = {
        technicianId: req.body.technicianId || 'tech-demo-01',
        technicianName: req.body.technicianName || 'Demo Technician',
        etaMinutes: Number(req.body.etaMinutes) || 45,
        offeredAt: nowIso()
    };
    call.technicianOfferAt = call.technicianOffer.offeredAt;
    call.technicianAccepted = false;
    transitionCall(call, 'technician_offered', 'technician_offered', { technicianId: call.technicianOffer.technicianId });

    return res.json({
        message: 'Technician offer sent',
        dispatchStatus: 'pending_technician_acceptance',
        ...toCallResponse(call)
    });
});

app.post('/api/grace/call/technician-acceptance', (req, res) => {
    const call = getCallOr404(req, res);
    if (!call) {
        return;
    }

    if (!call.technicianOffer) {
        return res.status(409).json({
            error: 'Technician offer must exist before acceptance.',
            dispatchStatus: getDispatchStatus(call),
            ...toCallResponse(call)
        });
    }

    call.technicianAccepted = req.body.technicianAccepted === true;
    call.technicianAcceptance = {
        technicianAccepted: call.technicianAccepted,
        acceptedAt: call.technicianAccepted ? nowIso() : null,
        notes: req.body.notes || null
    };
    call.technicianAcceptedAt = call.technicianAcceptance.acceptedAt;

    transitionCall(
        call,
        call.technicianAccepted ? 'technician_accepted' : 'technician_pending',
        'technician_acceptance_updated',
        { technicianAccepted: call.technicianAccepted }
    );

    return res.json({
        message: call.technicianAccepted ? 'Technician accepted' : 'Technician still pending',
        dispatchStatus: call.technicianAccepted ? 'estimate' : 'pending_technician_acceptance',
        ...toCallResponse(call)
    });
});

app.post('/api/grace/call/work-order-create', (req, res) => {
    const call = getCallOr404(req, res);
    if (!call) {
        return;
    }

    if (!call.scope?.accepted || !call.quote || !call.payment || !call.technicianOffer) {
        return res.status(409).json({
            error: 'Scope verification, quote, payment link, and technician offer are required before work order creation.',
            dispatchStatus: getDispatchStatus(call),
            ...toCallResponse(call)
        });
    }

    if (!call.technicianAccepted) {
        return res.status(409).json({
            error: 'Dispatch blocked until technicianAccepted === true.',
            dispatchStatus: 'pending_technician_acceptance',
            ...toCallResponse(call)
        });
    }

    if (!ensureTowWinchNotOffered(req.body)) {
        return res.status(422).json({
            error: 'Work orders cannot include towing/winching/recovery scope.',
            dispatchStatus: 'estimate',
            ...toCallResponse(call)
        });
    }

    call.workOrder = {
        workOrderId: req.body.workOrderId || `WO-${Date.now()}`,
        status: 'dispatch_confirmed',
        createdAt: nowIso(),
        notes: req.body.notes || null
    };
    call.workOrderAt = call.workOrder.createdAt;
    transitionCall(call, 'work_order_created', 'work_order_created', { workOrderId: call.workOrder.workOrderId });

    return res.status(201).json({
        message: 'Work order created and dispatch confirmed',
        dispatchStatus: 'dispatch_confirmed',
        ...toCallResponse(call)
    });
});

app.post('/api/grace/call/closeout', (req, res) => {
    const call = getCallOr404(req, res);
    if (!call) {
        return;
    }

    if (!call.workOrder) {
        return res.status(409).json({
            error: 'Work order must exist before closeout.',
            dispatchStatus: getDispatchStatus(call),
            ...toCallResponse(call)
        });
    }

    call.closeout = {
        resolution: req.body.resolution || 'Service complete',
        closedAt: nowIso()
    };
    call.closeoutAt = call.closeout.closedAt;
    transitionCall(call, 'closeout_complete', 'closeout_complete', { resolution: call.closeout.resolution });

    return res.json({
        message: 'Closeout complete',
        dispatchStatus: 'dispatch_confirmed',
        ...toCallResponse(call)
    });
});

app.get('/api/grace/call/:callId', (req, res) => {
    const call = getCallOr404(req, res);
    if (!call) {
        return;
    }

    return res.json(toCallResponse(call));
});

app.get('/api/grace/calls', (req, res) => {
    const calls = Array.from(graceCalls.values())
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .map((call) => ({
            callId: call.callId,
            lifecycleState: call.lifecycleState,
            dispatchStatus: getDispatchStatus(call),
            technicianAccepted: call.technicianAccepted,
            updatedAt: call.updatedAt
        }));

    return res.json({
        totalCalls: calls.length,
        latestCall: calls[0] || null,
        calls: calls.slice(0, 10)
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log('=======================================================');
        console.log(`⚡ GRACE MASTER HUB ONLINE - PORT ${PORT}`);
        console.log(`📍 WATCH CENTER BASE: ${LEHIGH_VALLEY_BASE.name} (${DEFAULT_RADIUS_MILES}-MILE OPERATIONAL FILTER)`);
        console.log('=======================================================');
    });
}

module.exports = {
    app,
    RATE_CARD,
    LEHIGH_VALLEY_BASE,
    DEFAULT_RADIUS_MILES,
    WATCH_CENTER_STALE_MS,
    haversineMiles,
    validateServiceScope,
    containsDisallowedPaymentFields,
    getActiveWatchCenter,
    resetInMemoryState: () => {
        if (process.env.NODE_ENV !== 'test') {
            throw new Error('resetInMemoryState is test-only.');
        }
        resetInMemoryState();
    },
    watchCenterState
};
