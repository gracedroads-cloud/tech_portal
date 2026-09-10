const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Storage file paths
const RADIO_LOGS_FILE = path.join(__dirname, 'radio_dispatch_logs.json');
const DVIR_FILE = path.join(__dirname, 'dvir_reports.json');

// --- SYSTEM STATUS ENDPOINT ---
app.get('/api/status', (req, res) => {
    res.json({
        status: "Live",
        message: "EH Unified Network Suite communicating perfectly with legal disclaimers active!"
    });
});

// --- CB RADIO & GRACE VOICE DISPATCH ENDPOINTS ---

// POST /api/radio/dispatch - Handle GRACE live voice intake & dispatch requests
app.post('/api/radio/dispatch', (req, res) => {
    const dispatchData = req.body;

    const newEntry = {
        id: "DISPATCH-" + Date.now(),
        timestamp: new Date().toISOString(),
        channel: dispatchData.channel || "CH-19",
        operator: dispatchData.operator || "Elijah Wright",
        mode: dispatchData.mode || "Direct Intake",
        customerInfo: dispatchData.customerInfo || {},
        serviceNotes: dispatchData.serviceNotes || "",
        status: "Dispatched"
    };

    let logs = [];
    if (fs.existsSync(RADIO_LOGS_FILE)) {
        try {
            const fileData = fs.readFileSync(RADIO_LOGS_FILE, 'utf8');
            logs = JSON.parse(fileData || "[]");
        } catch (err) {
            console.error("Error reading radio logs file:", err);
        }
    }

    logs.push(newEntry);

    try {
        fs.writeFileSync(RADIO_LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
        console.log(`[CB DISPATCH] Recorded intake ${newEntry.id} via ${newEntry.channel}`);

        return res.json({
            status: "Success",
            message: "GRACE Dispatch record created and saved to storage.",
            dispatchId: newEntry.id
        });
    } catch (err) {
        console.error("Failed to save dispatch log:", err);
        return res.status(500).json({ status: "Error", message: "Failed to persist dispatch log." });
    }
});

// GET /api/radio/logs - Retrieve radio and dispatch logs
app.get('/api/radio/logs', (req, res) => {
    if (fs.existsSync(RADIO_LOGS_FILE)) {
        try {
            const fileData = fs.readFileSync(RADIO_LOGS_FILE, 'utf8');
            return res.json(JSON.parse(fileData || "[]"));
        } catch (err) {
            return res.status(500).json({ status: "Error", message: "Failed to read dispatch logs." });
        }
    }
    res.json([]);
});

// --- DVIR ENDPOINTS ---

// GET /api/dvir - Retrieve stored DVIR reports
app.get('/api/dvir', (req, res) => {
    if (fs.existsSync(DVIR_FILE)) {
        try {
            const fileData = fs.readFileSync(DVIR_FILE, 'utf8');
            return res.json(JSON.parse(fileData || "[]"));
        } catch (err) {
            return res.status(500).json({ status: "Error", message: "Failed to read DVIR reports." });
        }
    }
    res.json([]);
});

// POST /api/dvir - Store new DVIR report
app.post('/api/dvir', (req, res) => {
    const report = req.body;
    report.id = "DVIR-" + Date.now();
    report.timestamp = new Date().toISOString();

    let reports = [];
    if (fs.existsSync(DVIR_FILE)) {
        try {
            const fileData = fs.readFileSync(DVIR_FILE, 'utf8');
            reports = JSON.parse(fileData || "[]");
        } catch (err) {
            console.error("Error reading DVIR file:", err);
        }
    }

    reports.push(report);

    try {
        fs.writeFileSync(DVIR_FILE, JSON.stringify(reports, null, 2), 'utf8');
        console.log(`[STORAGE] Saved ${report.id} Status:${report.safetyStatus || 'Passed'}`);
        return res.json({ status: "Success", reportId: report.id });
    } catch (err) {
        console.error("Failed to save DVIR report:", err);
        return res.status(500).json({ status: "Error", message: "Failed to persist DVIR report." });
    }
});

// Start express server
app.listen(PORT, () => {
    console.log("==================================================");
    console.log("🚀 SYSTEM READY: EH Unified API Server Active");
    console.log(`🌐 Listening safely on endpoint: http://localhost:${PORT}`);
    console.log("==================================================");
});