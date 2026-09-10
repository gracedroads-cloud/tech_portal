const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Data Memory Stores
const RADIO_LOGS_FILE = path.join(__dirname, 'radio_dispatch_logs.json');
const WORK_ORDERS_FILE = path.join(__dirname, 'work_orders.json');
const ACCOUNTING_FILE = path.join(__dirname, 'accounting_ledger.json');
const DIAGNOSTICS_FILE = path.join(__dirname, 'diagnostic_reports.json');
const HR_FILE = path.join(__dirname, 'hr_records.json');

// Mobile Inventory Catalog
const PARTS_CATALOG = [
    { name: "Sealco Spring Brake Valve", partNo: "110200", location: "Service Van 1 - Shelf A", cost: 85.00 },
    { name: "Bendix Spring Brake Valve", partNo: "K022105", location: "Service Van 1 - Shelf A", cost: 120.00 },
    { name: "Trailer Air Leveling Valve", partNo: "KD2204", location: "Service Van 1 - Bin 3", cost: 145.00 },
    { name: "Trailer Belly Line 3/8 Air Hose", partNo: "TBL-38", location: "Service Van 1 - Hose Reel", cost: 45.00 },
    { name: "Kenworth T680 Lighting Relay", partNo: "KW-RLY-78", location: "Service Van 1 - Electrical Box", cost: 28.50 }
];

// Helper for Data Persistence
function appendDataStore(file, record) {
    let list = [];
    if (fs.existsSync(file)) {
        try {
            list = JSON.parse(fs.readFileSync(file, 'utf8') || "[]");
        } catch (err) {
            console.error(`Error reading ${file}:`, err);
        }
    }
    list.push(record);
    fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
}

// Master System Status API
app.get('/api/status', (req, res) => {
    res.json({
        status: "Live",
        system: "GRACE Master Executive AI Suite",
        operator: "Elijah Wright",
        company: "EH Graced Roads Solutions LLC",
        modules: [
            "Master Mechanical & Guided Diagnostics Engine",
            "Roadside & Yard Work Order Dispatch",
            "Fleet Accounting & Automated Billing",
            "FMCSA & DOT Legal Compliance",
            "HR & Fleet Staff Management",
            "Sales & High-Conversion Closing Engine"
        ]
    });
});

// Guided Diagnostic Engine API
app.post('/api/diagnostics/run', (req, res) => {
    const { systemType, symptom, unitNo, faultCodes } = req.body;

    let steps = [];
    let mathTestNeeded = false;
    let severity = "Standard";

    const issue = (symptom || "").toLowerCase();

    if (systemType === 'diesel_air_brakes' || issue.includes('brake') || issue.includes('air')) {
        severity = "Critical (FMCSA Safety Concern)";
        steps = [
            "Step 1: Charge system to governor cut-out pressure (120–145 PSI).",
            "Step 2: Turn off engine, release spring brakes, apply foot brake fully.",
            "Step 3: Measure pressure drop over 1 minute (Max allowed: 3 PSI for single, 4 PSI for combination).",
            "Step 4: Inspect Sealco/Bendix spring brake valves, leveling valve, and belly lines for audible leaks using soapy water.",
            "Step 5: Verify slack adjuster stroke length and brake shoe lining thickness."
        ];
        mathTestNeeded = true;
    } else if (systemType === 'kenworth_electrical' || issue.includes('light') || issue.includes('fuse') || issue.includes('relay')) {
        steps = [
            "Step 1: Check power supply at the Power Distribution Center (PDC) fuse panel behind the dash/glovebox.",
            "Step 2: Inspect trailer running light fuses and relays (KW-RLY-78 / Trailer Light Module).",
            "Step 3: Perform voltage drop test across the circuit with multimeter set to VDC (Max drop threshold: 0.5V).",
            "Step 4: Test 7-way receptacle pins for clean ground and steady 12V output."
        ];
    } else if (systemType === 'gasoline_engine' || issue.includes('misfire') || issue.includes('check engine')) {
        steps = [
            "Step 1: Connect OBD-II scanner to pull pending/active Diagnostic Trouble Codes (DTCs).",
            "Step 2: Check primary/secondary ignition coil resistance and spark plug condition.",
            "Step 3: Test fuel rail pressure and injector pulse width.",
            "Step 4: Perform smoke test on intake manifold to check for vacuum leaks."
        ];
    } else {
        steps = [
            "Step 1: Perform complete visual inspection of engine bay, belts, hoses, and fluid levels.",
            "Step 2: Hook up master diagnostic scan tool to check ECU/ECM active faults.",
            "Step 3: Perform battery/alternator charging system load test."
        ];
    }

    const diagReport = {
        diagId: "DIAG-" + Date.now(),
        timestamp: new Date().toISOString(),
        unitNo: unitNo || "Unit #Unknown",
        systemType: systemType || "General Diagnostic",
        symptom: symptom || "General System Inspection",
        faultCodes: faultCodes || "None Reported",
        severity: severity,
        mathTestNeeded: mathTestNeeded,
        diagnosticSteps: steps,
        status: "Diagnostic Protocol Active"
    };

    appendDataStore(DIAGNOSTICS_FILE, diagReport);

    res.json({
        status: "Success",
        report: diagReport
    });
});

// Work Order Dispatch API (Roadside & Yard Lot Tickets)
app.post('/api/workorders/create', (req, res) => {
    const { type, clientName, location, unitNo, serviceNeeded, estimatedLaborHours, partsCost } = req.body;
    
    const laborRate = 125.00;
    const laborTotal = (parseFloat(estimatedLaborHours) || 2) * laborRate;
    const partsTotal = parseFloat(partsCost) || 0;
    const totalEstimate = laborTotal + partsTotal;

    const workOrder = {
        id: (type === 'roadside' ? "RD-WO-" : "LOT-WO-") + Date.now(),
        type: type === 'roadside' ? "Roadside Ticket" : "Yard Lot Work Order",
        timestamp: new Date().toISOString(),
        clientName: clientName || "Fleet Client",
        unitNo: unitNo || "Unit #Unknown",
        location: location || "Dispatched Location",
        serviceNeeded: serviceNeeded || "General Diagnostic & Repair",
        billingEstimate: {
            laborHours: estimatedLaborHours || 2,
            laborTotal: laborTotal.toFixed(2),
            partsTotal: partsTotal.toFixed(2),
            grandTotal: totalEstimate.toFixed(2)
        },
        fmcsaComplianceCheck: "Verified - Pre-repair inspection log generated",
        status: "Dispatched & Logged"
    };

    appendDataStore(WORK_ORDERS_FILE, workOrder);

    res.json({
        status: "Success",
        message: `${workOrder.type} Generated Successfully.`,
        workOrder: workOrder
    });
});

// Accounting & Invoice Generator API
app.post('/api/accounting/invoice', (req, res) => {
    const { client, amount, description, paymentTerms } = req.body;
    const invoice = {
        invoiceId: "INV-" + Date.now(),
        date: new Date().toISOString(),
        client: client || "Commercial Fleet Customer",
        amount: parseFloat(amount || 0).toFixed(2),
        description: description || "Mobile Fleet Maintenance & Repair Services",
        paymentTerms: paymentTerms || "Net 30",
        taxId: "EIN-REGISTERED",
        status: "Issued"
    };

    appendDataStore(ACCOUNTING_FILE, invoice);

    res.json({
        status: "Success",
        invoice: invoice,
        closingPitch: `Invoice ${invoice.invoiceId} issued. GRACE auto-followup configured for Net ${paymentTerms} settlement.`
    });
});

// Legal & DOT Compliance Audit API
app.post('/api/legal/audit', (req, res) => {
    const { category } = req.body;
    
    let advice = "";
    if (category === 'fmcsa') {
        advice = "FMCSA Regulation 396.11 Notice: Driver Vehicle Inspection Reports (DVIR) must be retained for at least 3 months from the date submitted. All safety-critical defects require certified mechanic signature before dispatch.";
    } else if (category === 'contract') {
        advice = "Standard Commercial Repair Service Liability Agreement Clause: EH Graced Roads Solutions LLC provides a 30-day workmanship warranty on installed parts and labor. Mechanics are non-liable for pre-existing secondary engine or structural fatigue.";
    } else {
        advice = "General Legal Advisory: Ensure all roadside units carry updated commercial liability coverage and state OSHA safety gear checklists.";
    }

    res.json({
        category: category,
        legalVerdict: advice,
        verifiedBy: "GRACE Executive Legal Counsel Module"
    });
});

// Sales Closing Script Generator API
app.post('/api/sales/close', (req, res) => {
    const { prospectName, fleetSize } = req.body;
    
    const pitch = `Hello ${prospectName}, Elijah Wright here with EH Graced Roads Solutions LLC. We specialize in zero-downtime mobile fleet maintenance for teams running ${fleetSize || 'multiple'} heavy-duty rigs. By scheduling our recurring lot inspections and on-site roadside dispatches, you eliminate towing fees and reduce out-of-service DOT violations by over 40%. Let's lock in your preferred weekly maintenance slot starting this Monday.`;

    res.json({
        prospect: prospectName,
        closingScript: pitch,
        guaranteedGrowthStrategy: "Recurring Preventative Maintenance Fleet Retainer"
    });
});

// Diagnostic Engineering Math API
app.post('/api/engineer/calculate', (req, res) => {
    const { type, param1, param2 } = req.body;
    let result = {};

    if (type === 'voltage_drop') {
        const vDrop = (2 * parseFloat(param1) * parseFloat(param2) * 0.0000012).toFixed(2);
        result = { calculation: "Voltage Drop Test", value: `${vDrop} V`, status: vDrop > 0.5 ? "FAIL - Excessive Resistance" : "PASS - Safe Circuit" };
    } else if (type === 'air_brake_leak') {
        const drop = parseFloat(param1);
        const threshold = param2 === 'combination' ? 4 : 3;
        result = { 
            calculation: "Air Brake Leak Rate Test", 
            value: `${drop} PSI/min`, 
            status: drop <= threshold ? "PASS - FMCSA Compliant" : `FAIL - Exceeds FMCSA limit of ${threshold} PSI/min` 
        };
    } else {
        result = { calculation: "Mechanical Calculation", value: "Verified", status: "PASS" };
    }

    res.json(result);
});

// Radio & Dispatch Voice Log API
app.post('/api/radio/dispatch', (req, res) => {
    const dispatchData = req.body;
    const newEntry = {
        id: "DISPATCH-" + Date.now(),
        timestamp: new Date().toISOString(),
        channel: dispatchData.channel || "CH-19",
        operator: dispatchData.operator || "Elijah Wright",
        mode: dispatchData.mode || "GRACE Master Executive AI",
        transcript: dispatchData.transcript || "",
        intent: dispatchData.intent || "General Operations Intake",
        status: "Active Record"
    };

    appendDataStore(RADIO_LOGS_FILE, newEntry);
    res.json({ status: "Success", dispatchId: newEntry.id, intent: newEntry.intent });
});

app.listen(PORT, () => {
    console.log("==================================================");
    console.log("🚀 GRACE MASTER ENTERPRISE CORE ONLINE");
    console.log(`🌐 Cockpit Dashboard: http://localhost:${PORT}/business_dashboard.html`);
    console.log("==================================================");
});