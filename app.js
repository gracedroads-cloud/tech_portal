// Path for storing CB Radio and GRACE Dispatch logs
const RADIO_LOGS_FILE = path.join(__dirname, 'radio_dispatch_logs.json');

// POST /api/radio/dispatch - Handle GRACE live voice intake & dispatch requests
app.post('/api/radio/dispatch', (req, res) => {
    const dispatchData = req.body;

    const newEntry = {
        id: "DISPATCH-" + Date.now(),
        timestamp: new Date().toISOString(),
        channel: dispatchData.channel || "CH-19",
        operator: dispatchData.operator || "Elijah Wright",
        mode: dispatchData.mode || "Direct Intake", // "Direct Intake", "GRACE Voice Processing", "Roadside On-Site"
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
        const fileData = fs.readFileSync(RADIO_LOGS_FILE, 'utf8');
        return res.json(JSON.parse(fileData || "[]"));
    }
    res.json([]);
});