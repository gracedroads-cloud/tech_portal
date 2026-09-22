const crypto = require('crypto');

function apiKeyAuth(req, res, next) {
    const configuredKey = process.env.DISPATCH_API_KEY;
    if (!configuredKey) {
        next();
        return;
    }

    const authorization = req.get('authorization');
    const providedKey = req.get('x-api-key') || (authorization && authorization.replace(/^Bearer\s+/i, '')) || req.query.apiKey;
    if (!providedKey || !keysMatch(configuredKey, providedKey)) {
        res.status(401).json({ success: false, error: 'A valid API key is required.' });
        return;
    }

    next();
}

function operationsAccess(req, res, next) {
    const configuredKey = process.env.OPERATIONS_ACCESS_KEY;
    if (!configuredKey) {
        res.status(503).json({
            success: false,
            error: 'Live operations access has not been configured.'
        });
        return;
    }

    const providedKey = req.get('x-operations-access-key') || req.query.operationsKey;
    if (!providedKey || !keysMatch(configuredKey, providedKey)) {
        res.status(403).json({
            success: false,
            error: 'Operations access is required.'
        });
        return;
    }

    next();
}

function keysMatch(expected, actual) {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

module.exports = apiKeyAuth;
module.exports.apiKeyAuth = apiKeyAuth;
module.exports.operationsAccess = operationsAccess;
