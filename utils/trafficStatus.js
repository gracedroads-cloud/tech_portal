async function getTrafficStatus() {
    const providerUrl = process.env.TRAFFIC_PROVIDER_URL;
    if (!providerUrl) {
        return {
            available: false,
            message: 'Live traffic provider is not configured. Dispatch activity and locations remain live from this console.'
        };
    }

    try {
        const response = await fetch(providerUrl, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) {
            throw new Error(`Provider returned HTTP ${response.status}`);
        }

        return {
            available: true,
            source: new URL(providerUrl).hostname,
            message: 'Live traffic provider is connected.'
        };
    } catch (error) {
        return {
            available: false,
            message: `Live traffic provider is unavailable: ${error.message}`
        };
    }
}

module.exports = { getTrafficStatus };
