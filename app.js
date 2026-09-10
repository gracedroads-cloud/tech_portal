// In app.js
app.post('/api/dvir', (req, res) => {
  const dvirRecord = req.body;
  const filePath = path.join(__dirname, 'data', 'dvir_logs.json');

  let logs = [];
  if (fs.existsSync(filePath)) {
    logs = JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]');
  }
  logs.unshift(dvirRecord);
  fs.writeFileSync(filePath, JSON.stringify(logs, null, 2));

  res.json({ success: true, message: "DVIR log saved on server" });
});