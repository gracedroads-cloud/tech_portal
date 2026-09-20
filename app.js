const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const operationsFile = path.join(dataDir, 'grace_operations.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const defaultOperations = {
    updatedAt: null,
    dispatches: [
        { id: 'BD-101', customer: 'Keystone Freight', vehicle: 'Kenworth T680 / Reefer', location: 'I-78 EB MM 71', issue: 'Trailer belly-line air leak', priority: 'Critical', cargo: 'Perishable goods', eta: '24 min', unit: 'Van #1', status: 'Awaiting dispatch', distance: 12 },
        { id: 'PM-204', customer: 'Lehigh Logistics', vehicle: 'Freightliner Cascadia', location: 'Allentown yard', issue: 'Preventive maintenance', priority: 'Routine', cargo: 'N/A', eta: 'Scheduled 14:00', unit: 'Unassigned', status: 'Scheduled', distance: 21 }
    ],
    fleet: [
        { unit: 'Van #1', technician: 'Marcus Reed', status: 'Ready', location: 'Easton HQ', availableAt: 'Now' },
        { unit: 'Van #2', technician: 'Dana Flores', status: 'On scene', location: 'I-78 WB MM 58', availableAt: '10:40' },
        { unit: 'Van #3', technician: 'Chris Nolan', status: 'Off duty', location: 'Bethlehem', availableAt: '18:00' }
    ],
    accounts: [
        { name: 'Keystone Freight', agreement: 'Signed', credit: 'Approved', contact: 'Fleet desk • 610-555-0192', ar: '$0' },
        { name: 'Lehigh Logistics', agreement: 'Renewal due Sep 30', credit: 'Approved', contact: 'AP • 484-555-0114', ar: '$1,240' }
    ],
    vendors: [
        { vendor: 'Valley Heavy Parts', item: 'DPF assembly', status: 'Confirmed • arriving 11:15', owner: 'Parts desk' },
        { vendor: 'Rapid Tow & Recovery', item: 'Heavy tow backup', status: 'Contract expires Oct 12', owner: 'Executive review' },
        { vendor: 'Tire Response PA', item: 'Roadside tire service', status: 'Active SLA', owner: 'Dispatch' }
    ],
    compliance: [
        { item: 'Marcus Reed • CDL / medical card', due: '2026-10-04', status: 'Due soon', owner: 'HR' },
        { item: 'Van #2 • DOT annual inspection', due: '2026-10-15', status: 'Due soon', owner: 'Fleet' },
        { item: 'Used oil & coolant disposal log', due: '2026-09-30', status: 'Due soon', owner: 'Operations' },
        { item: 'Garage liability policy', due: '2027-03-01', status: 'Current', owner: 'Executive' }
    ],
    workOrders: [
        { id: 'WO-4172', customer: 'Keystone Freight', labor: '$385', parts: '$642', callout: '$185', audit: 'Needs review', invoice: 'Pending' },
        { id: 'WO-4168', customer: 'Cedar Transport', labor: '$240', parts: '$96', callout: '$0', audit: 'Approved', invoice: 'Sent' }
    ],
    roster: [
        { shift: 'Now–16:00', primary: 'Marcus Reed • Van #1', backup: 'Dana Flores • Van #2', coverage: 'Easton / I-78' },
        { shift: '16:00–00:00', primary: 'Chris Nolan • Van #3', backup: 'Marcus Reed • Van #1', coverage: 'Lehigh Valley' },
        { shift: '00:00–08:00', primary: 'Dana Flores • Van #2', backup: 'Chris Nolan • Van #3', coverage: '24/7 roadside' }
    ],
    safety: { ppe: '32 high-vis vests • 18 glove kits • 9 cone sets', incident: 'No open incidents' },
    metrics: { response: '28 min', profitability: '41%', efficiency: '87%', repeatCustomers: '68%' },
    automations: [
        { domain: 'Fleet scheduling & routing', paths: [
            { id: 'dispatch-triage', name: 'Emergency triage', trigger: 'New service call', outcome: 'Ranks emergency, cargo risk, and customer SLA before routine work.' },
            { id: 'closest-unit-routing', name: 'Closest-unit routing', trigger: 'Critical job accepted', outcome: 'Assigns the nearest ready mobile unit and records the ETA.' },
            { id: 'eta-client-update', name: 'ETA client update', trigger: 'Unit assignment or delay', outcome: 'Prepares driver and fleet-manager ETA communication.' },
            { id: 'coverage-rebalance', name: 'Coverage rebalance', trigger: 'Unit unavailable or delayed', outcome: 'Flags a coverage gap and recommends the next available unit.' }
        ]},
        { domain: 'Fleet accounts & vendors', paths: [
            { id: 'account-onboarding', name: 'Account onboarding', trigger: 'New corporate account', outcome: 'Tracks credit review and signed master service agreement.' },
            { id: 'parts-order-watch', name: 'Parts order watch', trigger: 'Critical component ordered', outcome: 'Tracks ETA and escalates a repair-delay risk.' },
            { id: 'vendor-contract-watch', name: 'Vendor contract watch', trigger: 'Contract renewal window', outcome: 'Routes tow, tire, crane, and vendor agreements for review.' },
            { id: 'fleet-account-followup', name: 'Fleet account follow-up', trigger: 'Account service event', outcome: 'Logs relationship follow-up for carrier and logistics contacts.' }
        ]},
        { domain: 'Compliance & legal administration', paths: [
            { id: 'dot-fmcsa-check', name: 'DOT/FMCSA readiness check', trigger: 'Scheduled compliance review', outcome: 'Reviews service-truck and repair compliance readiness.' },
            { id: 'credential-expiry-watch', name: 'Credential expiry watch', trigger: 'CDL, ASE, or safety deadline', outcome: 'Escalates expiring technician credentials to the owner.' },
            { id: 'permit-insurance-renewal', name: 'Permit & insurance renewal', trigger: 'Renewal threshold reached', outcome: 'Routes roadside permits and garage liability renewals.' },
            { id: 'hazmat-log-review', name: 'Fluid disposal log review', trigger: 'Monthly environmental close', outcome: 'Verifies used oil and coolant disposal documentation.' }
        ]},
        { domain: 'Billing & financial support', paths: [
            { id: 'work-order-audit', name: 'Work-order audit', trigger: 'Field ticket submitted', outcome: 'Verifies labor, call-out fees, and parts markup.' },
            { id: 'invoice-release', name: 'Invoice release', trigger: 'Audit approved', outcome: 'Prepares the invoice for fleet AP or point-of-service payment.' },
            { id: 'ar-escalation', name: 'Accounts receivable escalation', trigger: 'Invoice past due', outcome: 'Creates a corporate fleet-account follow-up.' },
            { id: 'expense-reconciliation', name: 'Field expense reconciliation', trigger: 'Weekly close', outcome: 'Reconciles fuel, tolls, tools, and truck-maintenance expenses.' }
        ]},
        { domain: 'Workforce & emergency logistics', paths: [
            { id: 'on-call-fatigue-review', name: 'On-call fatigue review', trigger: 'Roster change or extended call-out', outcome: 'Balances coverage with technician rest requirements.' },
            { id: 'incident-mobilization', name: 'Incident mobilization', trigger: 'Service-unit incident', outcome: 'Starts backup dispatch, safety, and insurance intake steps.' },
            { id: 'ppe-readiness-check', name: 'PPE readiness check', trigger: 'Shift start or stock threshold', outcome: 'Checks highway-safety vest, glove, boot, and cone inventory.' },
            { id: 'shift-handoff', name: 'Shift handoff', trigger: 'On-call rotation change', outcome: 'Packages open jobs and priority notes for the next team.' }
        ]},
        { domain: 'Office operations & software ownership', paths: [
            { id: 'software-health-check', name: 'Operations software health check', trigger: 'Daily opening', outcome: 'Confirms dispatch and garage-management workspace readiness.' },
            { id: 'executive-kpi-report', name: 'Executive KPI report', trigger: 'Weekly or monthly close', outcome: 'Compiles response, profitability, efficiency, and repeat-customer metrics.' },
            { id: 'admin-work-queue', name: 'Junior admin work queue', trigger: 'New operational task', outcome: 'Routes dispatch, parts-runner, and office-clerk assignments.' },
            { id: 'process-exception-review', name: 'Process exception review', trigger: 'Service or workflow exception', outcome: 'Logs an owner-visible exception and recommended next step.' }
        ]}
    ],
    activity: ['GRACE online: operational command center ready.']
};

function readOperations() {
    if (!fs.existsSync(operationsFile)) {
        return { ...defaultOperations, updatedAt: new Date().toISOString() };
    }
    return JSON.parse(fs.readFileSync(operationsFile, 'utf8'));
}

function writeOperations(operations) {
    operations.updatedAt = new Date().toISOString();
    fs.writeFileSync(operationsFile, JSON.stringify(operations, null, 2));
}

function logActivity(operations, message) {
    operations.activity.unshift(`${new Date().toLocaleTimeString()} — ${message}`);
    operations.activity = operations.activity.slice(0, 12);
}

function findAutomation(operations, id) {
    for (const domain of operations.automations) {
        const automation = domain.paths.find((workflow) => workflow.id === id);
        if (automation) {
            return { domain, automation };
        }
    }
    return null;
}

function readAutomationFields(body, requiredFields) {
    const fields = {};
    for (const field of requiredFields) {
        if (typeof body[field] !== 'string' || !body[field].trim()) {
            return null;
        }
        fields[field] = body[field].trim();
    }
    return fields;
}

app.get('/api/grace/operations', (_req, res) => {
    try {
        res.json(readOperations());
    } catch (error) {
        console.error('Unable to load GRACE operations:', error);
        res.status(500).json({ error: 'Unable to load operations data.' });
    }
});

app.post('/api/grace/automations', (req, res) => {
    const domainName = typeof req.body.domain === 'string' ? req.body.domain.trim() : '';
    const fields = req.body.automation && typeof req.body.automation === 'object'
        ? readAutomationFields(req.body.automation, ['id', 'name', 'trigger', 'outcome'])
        : null;
    if (!domainName || !fields || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(fields.id)) {
        return res.status(400).json({ error: 'Provide a domain and automation id, name, trigger, and outcome. Automation ids use lowercase letters, numbers, and hyphens.' });
    }

    const operations = readOperations();
    if (findAutomation(operations, fields.id)) {
        return res.status(409).json({ error: 'An automation workflow already uses that id.' });
    }

    let domain = operations.automations.find((item) => item.domain === domainName);
    if (!domain) {
        domain = { domain: domainName, paths: [] };
        operations.automations.push(domain);
    }
    domain.paths.push(fields);
    logActivity(operations, `Automation added: ${fields.name} for ${domainName}.`);
    writeOperations(operations);
    res.status(201).json({ success: true, automation: fields, operations });
});

app.put('/api/grace/automations/:id', (req, res) => {
    const changes = {};
    for (const field of ['name', 'trigger', 'outcome']) {
        if (field in req.body) {
            if (typeof req.body[field] !== 'string' || !req.body[field].trim()) {
                return res.status(400).json({ error: `${field} must be a non-empty string.` });
            }
            changes[field] = req.body[field].trim();
        }
    }
    if (!Object.keys(changes).length) {
        return res.status(400).json({ error: 'Provide at least one of name, trigger, or outcome to update.' });
    }

    const operations = readOperations();
    const match = findAutomation(operations, req.params.id);
    if (!match) {
        return res.status(404).json({ error: 'Automation workflow not found.' });
    }

    Object.assign(match.automation, changes);
    logActivity(operations, `Automation updated: ${match.automation.name} for ${match.domain.domain}.`);
    writeOperations(operations);
    res.json({ success: true, automation: match.automation, operations });
});

app.post('/api/grace/actions', (req, res) => {
    const { type, id } = req.body;
    const operations = readOperations();
    let message;

    if (type === 'dispatch-closest') {
        const dispatch = operations.dispatches
            .filter((item) => item.status === 'Awaiting dispatch')
            .sort((a, b) => a.distance - b.distance)[0];
        const unit = operations.fleet.find((item) => item.status === 'Ready');
        if (!dispatch || !unit) {
            return res.status(409).json({ error: 'No ready unit or pending dispatch is available.' });
        }
        dispatch.unit = unit.unit;
        dispatch.status = 'En route';
        unit.status = 'En route';
        unit.location = dispatch.location;
        message = `${unit.unit} assigned to ${dispatch.id}; ${dispatch.customer} ETA confirmed at ${dispatch.eta}.`;
    } else if (type === 'audit-work-order') {
        const workOrder = operations.workOrders.find((item) => item.id === id);
        if (!workOrder) {
            return res.status(404).json({ error: 'Work order not found.' });
        }
        workOrder.audit = 'Approved';
        workOrder.invoice = 'Ready to send';
        message = `${workOrder.id} audited: labor, call-out fee, and parts markup approved for invoicing.`;
    } else if (type === 'notify-eta') {
        const dispatch = operations.dispatches.find((item) => item.id === id);
        if (!dispatch) {
            return res.status(404).json({ error: 'Dispatch not found.' });
        }
        message = `ETA update queued for ${dispatch.customer}: ${dispatch.unit} arrival in ${dispatch.eta}.`;
    } else if (type === 'vendor-follow-up') {
        const vendor = operations.vendors.find((item) => item.vendor === id);
        if (!vendor) {
            return res.status(404).json({ error: 'Vendor not found.' });
        }
        vendor.status = 'Follow-up requested • awaiting confirmation';
        message = `Vendor follow-up requested from ${vendor.vendor}.`;
    } else if (type === 'mobilize-incident') {
        operations.safety.incident = 'Backup unit and insurance incident workflow mobilized';
        message = 'Incident response mobilized: backup coverage, safety check, and insurance intake initiated.';
    } else if (type === 'run-automation') {
        const match = findAutomation(operations, id);
        if (!match) {
            return res.status(404).json({ error: 'Automation workflow not found.' });
        }
        match.automation.lastRunAt = new Date().toISOString();
        message = `${match.automation.name} run for ${match.domain.domain}: ${match.automation.outcome}`;
    } else {
        return res.status(400).json({ error: 'Unsupported GRACE action.' });
    }

    logActivity(operations, message);
    writeOperations(operations);
    res.json({ success: true, message, operations });
});

app.post('/api/dvir', (req, res) => {
    try {
        const filePath = path.join(dataDir, `dvir_${Date.now()}.json`);
        fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2));
        res.status(200).json({ success: true, message: 'DVIR record saved successfully', file: filePath });
    } catch (error) {
        console.error('Error saving DVIR:', error);
        res.status(500).json({ success: false, error: 'Unable to save DVIR record.' });
    }
});

app.get('/api/status', (_req, res) => {
    res.json({ status: 'ONLINE', base: 'Lehigh Valley, PA', port: PORT, timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`GRACE Master Hub online at http://localhost:${PORT}`);
});
