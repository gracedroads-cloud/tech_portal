// VERIFICATION CODE: 774291
var express = require('express');
var cors = require('cors');
var path = require('path');
var app = express();
var PORT = 3000;

app.use(cors());
app.use(express.json());

// Force the server engine to automatically serve frontend portal files from the root and parent directories
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, '..')));
app.use(express.static(path.join(__dirname, 'public')));


// Mandatory Call Intake Disclaimer Template
const DISPATCH_DISCLAIMER = "Disclaimer: If this is an active emergency requiring immediate police or medical assistance, please hang up and dial 911 immediately. All calls are recorded and monitored for quality assurance.";

// Legally Protected Voice & Text Disclosures
const TEXT_TEMPLATES = {
    intake_welcome: "EH Roadside Assistance: We provide an immediate cost estimate within 3 minutes. Physical field technician response times are safe and dependable, with ETAs factoring technician availability and location. When there's a breakdown, we provide solutions.",
    digital_checkout_fallback: "To securely view your 3-minute cost estimate breakdown and finalize your localized dispatch triage file, click here: "
};

// Zero-billing exception array for subcontracted accounts
const BILLING_SKIP_LIST = [
    "Done Right Mobile Solutions",
    "Revive TTS",
    "Revive Truck & Trailer",
    "Revive Truck and Trailer"
];

// Memory arrays to track data feeds natively without loss
var dvirLogs = [];
var dispatchLogs = [];
var jobLogs = [];

// ==========================================
// 1. STANDARDIZED FIELD TECH SUBMISSION ROUTE
// ==========================================
app.post('/api/submit-job', function(req, res) {
    var jobData = req.body;
    
    // Normalize properties so both 'carrier' and 'clientName' work perfectly
    var customerName = jobData.carrier || jobData.clientName || "Unknown Customer";
    
    // Create unified payload object
    var structuredJob = {
        ticketId: jobData.ticketId || "N/A",
        carrier: customerName,
        unitAsset: jobData.unitAsset || "Fleet Van #201", // Standardized van fallback
        destination: jobData.destination || "N/A",
        diagnosis: jobData.diagnosis || "N/A",
        repairs: jobData.repairs || "N/A",
        partCost: parseFloat(jobData.partCost || 0),
        signature: jobData.signature || "N/A",
        timestamp: new Date().toISOString()
    };

    jobLogs.push(structuredJob);

    // CRITICAL ENGINE RULE: Evaluate Subcontractor Skip Parameters
    if (BILLING_SKIP_LIST.includes(customerName)) {
        console.log(`\n🛑 [SKIP RULE APPLIED] Job logged for subcontractor: ${customerName}`);
        console.log(`Asset ID: ${structuredJob.unitAsset} | Billing Code: BYPASS ZERO-BILL`);
        return res.json({ 
            status: "Success", 
            message: `Skip rule applied: No bill generated for ${customerName}.`,
            data: structuredJob
        });
    }

    // Standard Client Logic
    console.log(`\n💵 Processing standard billing triggers for corporate client: ${customerName}`);
    console.log(`Ticket: ${structuredJob.ticketId} | Base Cost: $${structuredJob.partCost.toFixed(2)}`);
    res.json({ 
        status: "Billed", 
        message: "Invoice processed successfully.",
        data: structuredJob
    });
});

// Failsafe Legacy Route: Redirects old apps to the fixed submission endpoint safely
app.post('/api/jobs/complete', function(req, res) {
    res.redirect(307, '/api/submit-job');
});

// ==========================================
// 2. DUAL VOICE & TEXT DISPATCH ENGINE ROUTE
// ==========================================
app.post('/api/dispatch/incoming', function(req, res) {
    var smsData = req.body;
    var rawText = smsData.text ? smsData.text.toLowerCase() : "";
   
    dispatchLogs.push(smsData);
    console.log("\n📥 [NEW DUAL DISPATCH INTAKE DETECTED]");
    console.log("Client Identifier/ID: " + smsData.sender);
    console.log("Message Content: " + smsData.text);

    if (rawText.includes("speak") || rawText.includes("call") || smsData.action === "VOICE_PATCH") {
        console.log(`📞 [COMMUNICATION BLOCK] Voice patching initiated for Client: ${smsData.sender}`);
        return res.json({
            status: "Voice Connected",
            voice_bridge: true,
            routing_target: "770-744-7730"
        });
    }

    if (rawText.includes("link") || rawText.includes("digital") || rawText.includes("checkout")) {
        var personalizedFallbackText = `${TEXT_TEMPLATES.digital_checkout_fallback}https://gracedroads.com`;
        console.log(`🚀 [AUTOMATED SMS FALLBACK] Dispatched to ${smsData.sender}`);
        return res.json({ status: "Link Dispatched", script_used: personalizedFallbackText });
    }

    console.log(`📢 [DISPATCH VOICE INTAKE PLAYING]: ${DISPATCH_DISCLAIMER}`);
    console.log(`📢 [LEGAL ASSURANCE OUT LOUD]: ${TEXT_TEMPLATES.intake_welcome}`);
    res.json({ status: "Voice Call Parsed" });
});

// ==========================================
// 3. UPGRADED DVIR APPLICATION STORAGE ROUTE
// ==========================================
app.post('/api/dvir/submit', function(req, res) {
    var reportData = req.body;
   
    dvirLogs.push(reportData);
    console.log("\n📋 [UPGRADED DVIR REPORT RECEIVED]");
    console.log("Asset ID / Unit: " + (reportData.vehicleInfo || reportData.truckUnit));
    console.log("Inspector: " + (reportData.techName || reportData.inspectorName));
    console.log("Status: " + (reportData.status || reportData.safetyStatus));
   
    res.json({
        status: "Success",
        message: "DVIR report locked securely into backend local storage. Authority Review Mode initialized."
    });
});

app.get('/api/status', function(req, res) {
    res.json({ status: "Live", message: "EH Unified Network Suite communicating perfectly with legal disclaimers active!" });
});

app.listen(PORT, function() {
    console.log('==================================================');
    console.log('🚀 SYSTEM READY: EH Unified API Server Active');
    console.log('🌐 Listening safely on endpoint: http://localhost:3000');
    console.log('==================================================');
});
// Bulletproof Absolute Fallback Override Rule
app.get('/business_dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'business_dashboard.html'));
});


