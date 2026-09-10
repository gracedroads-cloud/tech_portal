app.get('/api/dvir/reports', (req, res) => {
    if (fs.existsSync(REPORTS_FILE)) {
        const fileData = fs.readFileSync(REPORTS_FILE, 'utf8');
        return res.json(JSON.parse(fileData || "[]"));
    }
    res.json([]);
});