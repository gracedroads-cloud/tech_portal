function redactUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch (error) {
    return 'invalid-url';
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTeamsAdapter(config, logger) {
  const health = {
    mode: config.teamsWebhookUrl ? 'external' : 'simulation',
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null
  };

  async function postExternal(message) {
    let lastError = null;
    for (let attempt = 0; attempt <= config.teamsRetries; attempt += 1) {
      health.lastAttemptAt = new Date().toISOString();
      try {
        const response = await Promise.race([
          fetch(config.teamsWebhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: message.text })
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Teams timeout')), config.outboundTimeoutMs))
        ]);

        if (!response.ok) {
          throw new Error(`Teams endpoint returned ${response.status}`);
        }

        health.lastSuccessAt = new Date().toISOString();
        health.lastError = null;
        logger('info', 'teams.notification.sent', { url: redactUrl(config.teamsWebhookUrl) });
        return { delivered: true, mode: 'external' };
      } catch (error) {
        lastError = error;
        health.lastError = error.message;
        logger('warn', 'teams.notification.retry', { attempt, message: error.message });
        if (attempt < config.teamsRetries) {
          await wait(config.teamsBackoffMs * (attempt + 1));
        }
      }
    }

    throw lastError;
  }

  return {
    getHealth() {
      return { ...health };
    },
    async postStatusSummary(message) {
      if (!config.teamsWebhookUrl) {
        health.lastAttemptAt = new Date().toISOString();
        health.lastSuccessAt = health.lastAttemptAt;
        health.lastError = null;
        logger('info', 'teams.notification.simulated', { summary: message.text.slice(0, 120) });
        return { delivered: true, mode: 'simulation' };
      }
      return postExternal(message);
    }
  };
}

module.exports = { createTeamsAdapter };
