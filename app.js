// Master File Pull API
app.get('/api/files/pull', (req, res) => {
    const fileType = req.query.type;
    let filePath = "";

    switch(fileType) {
        case 'work_orders':
            filePath = WORK_ORDERS_FILE;
            break;
        case 'diagnostics':
            filePath = DIAGNOSTICS_FILE;
            break;
        case 'accounting':
            filePath = ACCOUNTING_FILE;
            break;
        case 'radio_logs':
            filePath = RADIO_LOGS_FILE;
            break;
        case 'hr':
            filePath = HR_FILE;
            break;
        default:
            return res.status(400).json({ status: "Error", message: "Invalid file type requested." });
    }

    if (fs.existsSync(filePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8') || "[]");
            res.json({ status: "Success", fileType: fileType, records: data });
        } catch (err) {
            res.status(500).json({ status: "Error", message: "Error reading file data." });
        }
    } else {
        res.json({ status: "Success", fileType: fileType, records: [] });
    }
});