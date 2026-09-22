const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { ensureDir, storeRecord } = require('./persistence');
const {
  normalizeDvir,
  normalizeStreamOverride,
  normalizeOnboarding,
  normalizeOwnerDraw,
  normalizeWaiver,
  normalizeDispatchRequest,
} = require('./validation');

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function createRuntimeConfig(overrides = {}) {
  const allowedOrigins = (overrides.allowedOrigins || process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    port: Number(overrides.port || process.env.PORT || 3000),
    env: overrides.env || process.env.NODE_ENV || 'development',
    dataDir: path.resolve(overrides.dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data')),
    requestSizeLimit: overrides.requestSizeLimit || process.env.REQUEST_SIZE_LIMIT || '100kb',
    operatorToken: overrides.operatorToken !== undefined ? overrides.operatorToken : (process.env.OPERATOR_TOKEN || ''),
    allowDemoWriteMode: overrides.allowDemoWriteMode !== undefined
      ? Boolean(overrides.allowDemoWriteMode)
      : parseBoolean(process.env.ALLOW_DEMO_WRITE_MODE),
    allowedOrigins,
  };
}

const simulatedBreakdowns = [
  {
    id: 'BD-DEMO-101',
    vehicle: 'Freightliner Cascadia',
    issue: 'Brake chamber pressure loss',
    location: 'I-78 WB MM 49.2',
    distanceMiles: 26.4,
    severity: 'high',
  },
  {
    id: 'BD-DEMO-102',
    vehicle: 'Kenworth T680',
    issue: 'Trailer air-line rupture',
    location: 'US-22 EB Exit 13',
    distanceMiles: 41.7,
    severity: 'medium',
  },
];

function errorBody({ code, message, requestId, details }) {
  return {
    ok: false,
    error: {
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
    },
  };
}

function constantTimeMatch(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');

  if (left.length !== right.length) {
    const padded = Buffer.alloc(Math.max(left.length, right.length));
    return crypto.timingSafeEqual(padded, padded) && false;
  }

  return crypto.timingSafeEqual(left, right);
}

function createApp(overrides = {}) {
  const config = createRuntimeConfig(overrides);
  const rootDir = process.cwd();
  const app = express();

  app.disable('x-powered-by');

  app.use((req, res, next) => {
    req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const elapsedMs = Date.now() - started;
      console.info(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${elapsedMs}ms) req=${req.requestId}`);
    });
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));

  app.use(cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      if (!config.allowedOrigins.length) {
        return callback(null, true);
      }
      if (config.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS origin denied'));
    },
    methods: ['GET', 'POST'],
  }));

  app.use(express.json({ limit: config.requestSizeLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.requestSizeLimit }));

  app.use(express.static(path.join(rootDir, 'public')));

  let persistenceReady = false;
  let persistenceError = null;

  const persistenceReadyPromise = ensureDir(config.dataDir)
    .then(() => {
      persistenceReady = true;
    })
    .catch((err) => {
      persistenceError = 'Data directory initialization failed.';
      console.error(`Failed to initialize data directory: ${err?.message || 'unknown error'}`);
      throw err;
    });

  const writeMode = config.operatorToken
    ? 'token_required'
: (config.allowDemoWriteMode && String(config.env).toLowerCase() !== 'production' ? 'demo_no_auth' : 'disabled');

  const frontendRouteInventory = [];
  function registerApiRoute(method, routePath, ...handlers) {
    if (typeof routePath === 'string' && routePath.startsWith('/api/')) {
      frontendRouteInventory.push({ method: method.toUpperCase(), path: routePath });
    }
    return app[method](routePath, ...handlers);
  }

  function rejectWithError(res, status, code, message, requestId, details) {
    return res.status(status).json(errorBody({ code, message, requestId, details }));
  }

  function requireMutatingAccess(req, res, next) {
    if (writeMode === 'disabled') {
      return rejectWithError(
        res,
        503,
        'writes_disabled',
        'Mutating endpoints are disabled. Configure OPERATOR_TOKEN or ALLOW_DEMO_WRITE_MODE=true.',
        req.requestId,
      );
    }

    if (writeMode === 'demo_no_auth') {
      req.authContext = { mode: 'demo_no_auth' };
      return next();
    }

    const token = req.header('x-operator-token');
    if (!token || !constantTimeMatch(token, config.operatorToken)) {
      return rejectWithError(res, 401, 'unauthorized', 'Valid operator token is required.', req.requestId);
    }

    req.authContext = { mode: 'token_required' };
    return next();
  }

  async function writeOperation(req, res, normalizeResult, storeOptions, successMessage, responseBuilder) {
    try {
      await persistenceReadyPromise;
    } catch (_error) {
      return rejectWithError(res, 503, 'persistence_unavailable', 'Persistence layer is not ready.', req.requestId);
    }

    if (!persistenceReady) {
      return rejectWithError(res, 503, 'persistence_unavailable', 'Persistence layer is not ready.', req.requestId);
    }

    if (normalizeResult.errors.length) {
      return rejectWithError(res, 400, 'validation_failed', 'Request validation failed.', req.requestId, normalizeResult.errors);
    }

    const record = await storeRecord({
      dataDir: config.dataDir,
      collection: storeOptions.collection,
      prefix: storeOptions.prefix,
      record: {
        ...normalizeResult.normalized,
        requestId: req.requestId,
        authMode: req.authContext.mode,
      },
    });

    return res.status(201).json({
      ok: true,
      message: successMessage,
      requestId: req.requestId,
      writeMode,
      demo: writeMode === 'demo_no_auth',
      ...(responseBuilder ? responseBuilder(record) : { id: record.id, createdAt: record.createdAt }),
    });
  }

  app.get('/healthz', (req, res) => {
    res.status(200).json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
  });

  app.get('/index.html', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
  });

  app.get('/no_tow_authorization.html', (req, res) => {
    res.sendFile(path.join(rootDir, 'no_tow_authorization.html'));
  });

  app.get('/readyz', (req, res) => {
    const ready = persistenceReady;
    const status = ready ? 'ready' : 'degraded';
    const code = ready ? 200 : 503;
    res.status(code).json({
      ok: ready,
      status,
      writeMode,
      message: ready
        ? 'Service is ready. Check writeMode for mutating-route availability.'
        : (persistenceError || 'Persistence layer is not ready.'),
      timestamp: new Date().toISOString(),
    });
  });

  registerApiRoute('get', '/api/routes', (req, res) => {
    res.json({
      ok: true,
      frontendRouteInventory,
      writeMode,
    });
  });

  registerApiRoute('get', '/api/status', (req, res) => {
    res.json({
      ok: true,
      status: 'online',
      mode: config.env,
      writeMode,
      integrations: {
        breakdownFeed: {
          state: 'offline',
          source: 'simulated_demo_data',
          message: 'Live carrier telematics integration is not configured in this prototype.',
        },
      },
      timestamp: new Date().toISOString(),
    });
  });

  registerApiRoute('get', '/api/dvir', (req, res) => {
    res.json({
      ok: true,
      message: 'Use POST /api/dvir to submit DVIR records. Data is prototype-local and auditable in the configured data directory.',
      writeMode,
      timestamp: new Date().toISOString(),
    });
  });

  registerApiRoute('post', '/api/dvir', requireMutatingAccess, async (req, res, next) => {
    try {
      await writeOperation(
        req,
        res,
        normalizeDvir(req.body),
        { collection: 'dvir_reports', prefix: 'DVIR' },
        'DVIR record stored.',
      );
    } catch (err) {
      next(err);
    }
  });

  registerApiRoute('get', '/api/breakdowns/scanner', (req, res) => {
    const radiusRaw = req.query.radius;
    const radius = radiusRaw === undefined ? 150 : Number(radiusRaw);

    if (!Number.isFinite(radius) || radius <= 0 || radius > 500) {
      return rejectWithError(res, 400, 'validation_failed', 'radius must be a number between 1 and 500.', req.requestId);
    }

    const breakdowns = simulatedBreakdowns
      .filter((item) => item.distanceMiles <= radius)
      .sort((a, b) => a.distanceMiles - b.distanceMiles)
      .map((item) => ({
        ...item,
        distance: `${item.distanceMiles.toFixed(1)} mi`,
        status: 'simulated',
        source: 'simulated_demo_data',
      }));

    return res.json({
      ok: true,
      source: 'simulated_demo_data',
      integration: {
        state: 'offline',
        message: 'No live mapping/carrier feed is configured.',
      },
      radiusMiles: radius,
      breakdowns,
      timestamp: new Date().toISOString(),
    });
  });

  registerApiRoute('post', '/api/stream/override', requireMutatingAccess, async (req, res, next) => {
    try {
      const normalized = normalizeStreamOverride(req.body);
      await writeOperation(
        req,
        res,
        normalized,
        { collection: 'stream_overrides', prefix: 'OVR' },
        'Stream override request accepted.',
        (record) => ({
          override: {
            id: record.id,
            action: record.action,
            state: record.action === 'pickup' ? 'human_operator_override' : 'grace_ai_resumed',
            createdAt: record.createdAt,
            source: 'simulated_demo_data',
          },
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  registerApiRoute('post', '/api/submit-job', requireMutatingAccess, async (req, res, next) => {
    try {
      await writeOperation(
        req,
        res,
        normalizeWaiver(req.body),
        { collection: 'waiver_submissions', prefix: 'WVR' },
        'Waiver recorded.',
      );
    } catch (err) {
      next(err);
    }
  });

  registerApiRoute('post', '/api/onboarding', requireMutatingAccess, async (req, res, next) => {
    try {
      await writeOperation(
        req,
        res,
        normalizeOnboarding(req.body),
        { collection: 'onboarding_requests', prefix: 'ONB' },
        'Onboarding request recorded.',
      );
    } catch (err) {
      next(err);
    }
  });

  registerApiRoute('post', '/api/owner-draws', requireMutatingAccess, async (req, res, next) => {
    try {
      await writeOperation(
        req,
        res,
        normalizeOwnerDraw(req.body),
        { collection: 'owner_draw_requests', prefix: 'ODR' },
        'Owner draw request recorded for review.',
      );
    } catch (err) {
      next(err);
    }
  });

  registerApiRoute('post', '/api/dispatch/quotes', requireMutatingAccess, async (req, res, next) => {
    try {
      await writeOperation(
        req,
        res,
        normalizeDispatchRequest(req.body),
        { collection: 'dispatch_quotes', prefix: 'DSQ' },
        'Dispatch quote intake recorded.',
      );
    } catch (err) {
      next(err);
    }
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    if (err?.type === 'entity.too.large') {
      return rejectWithError(res, 413, 'payload_too_large', 'Payload exceeds request size limit.', req.requestId);
    }

    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return rejectWithError(res, 400, 'invalid_json', 'Malformed JSON request body.', req.requestId);
    }

    if (err?.message === 'CORS origin denied') {
      return rejectWithError(res, 403, 'cors_denied', 'Origin is not allowed by CORS policy.', req.requestId);
    }

    console.error(`[${req.requestId}] Unexpected server error`, { message: err?.message, name: err?.name });
    return rejectWithError(res, 500, 'internal_error', 'An internal server error occurred.', req.requestId);
  });

  return { app, config, persistenceReadyPromise };
}

module.exports = {
  createApp,
  createRuntimeConfig,
};
