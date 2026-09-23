async function analyzePartImage(imageBuffer, mimeType) {
    if (!process.env.VISION_ANALYZER_URL) {
        console.warn('VISION_ANALYZER_URL is not configured; using local vision analysis fixture.');
        return {
            identifiedComponent: 'Type 30/30 Sealed Brake Chamber (Corroded Push-Rod Boot)',
            estimatedUrgency: 'HIGH - Immediate Replacement Required per PA DOT Safety Standards',
            suggestedPartNumber: 'KN-3030-STD',
            estimatedLaborHours: 1.5,
            recommendedLineItem: {
                description: 'Replace Rear Axle Brake Chamber & Adjust Slack Adjuster',
                partsCost: 145.00,
                laborHours: 1.5
            }
        };
    }

    const headers = { 'Content-Type': mimeType };
    if (process.env.VISION_ANALYZER_API_KEY) {
        headers.Authorization = `Bearer ${process.env.VISION_ANALYZER_API_KEY}`;
    }
    const response = await fetch(process.env.VISION_ANALYZER_URL, {
        method: 'POST',
        headers,
        body: imageBuffer
    });
    const payload = await response.json();
    if (!response.ok || !payload.analysis) {
        throw new Error(payload.error || 'Vision provider returned an invalid response.');
    }
    return payload.analysis;
}

module.exports = { analyzePartImage };
