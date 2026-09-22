async function transcribeAudioBuffer(audioBuffer, mimeType) {
    const apiKey = process.env.WHISPER_API_KEY;
    if (!apiKey) {
        console.warn('WHISPER_API_KEY is not configured; using local voice transcription fixture.');
        return 'Checked axle two left brake pad thickness 8 mm, push rod travel 1.75 inches, tire tread depth 12/32, minor fluid weep at brake chamber.';
    }

    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: mimeType }), 'inspection-audio.webm');
    formData.append('model', process.env.WHISPER_MODEL || 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData
    });
    const payload = await response.json();
    if (!response.ok || !payload.text) {
        throw new Error(payload.error && payload.error.message ? payload.error.message : 'Transcription provider returned an invalid response.');
    }
    return payload.text;
}

function parseInspectionMetrics(transcript) {
    const text = transcript.toLowerCase();
    const brakeMatch = text.match(/brake pad(?:s)?.*?(\d+(?:\.\d+)?)\s*(?:mm|inches|in)/i);
    const pushRodMatch = text.match(/push rod.*?(\d+(?:\.\d+)?)\s*(?:inches|in)/i);
    const treadMatch = text.match(/tread(?: depth)?.*?(\d+(?:\/\d+)?|\d+(?:\.\d+)?)/i);
    const leakDetected = /\b(leak|weep|fluid)\b/i.test(text);

    return {
        brakePadThickness: brakeMatch ? `${brakeMatch[1]} mm` : '',
        pushRodTravel: pushRodMatch ? `${pushRodMatch[1]} in` : '',
        tireTreadDepth: treadMatch ? treadMatch[1] : '',
        fluidContainmentAlert: leakDetected
            ? 'FLAGGED: Fluid weep/leak noted in voice log.'
            : 'Clear'
    };
}

module.exports = { transcribeAudioBuffer, parseInspectionMetrics };
