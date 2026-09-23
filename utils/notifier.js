class Notifier {
    constructor(options = {}) {
        this.emailSender = options.emailSender || this.createConsoleSender('email');
        this.smsSender = options.smsSender || this.createConsoleSender('SMS');
    }

    createConsoleSender(channel) {
        return async message => {
            console.log(`Dispatch ${channel} notification queued:`, message);
            return { channel, status: 'mocked' };
        };
    }

    async notifyDispatch(taskData, dispatchResult, result) {
        const billing = result.billing || {};
        const carrier = billing.carrierAccount || taskData.carrier || 'STANDARD FLEET';
        const location = dispatchResult.location || dispatchResult.breakdownLocation || taskData.location || 'PA service corridor';
        const summary = {
            carrier,
            location,
            priority: dispatchResult.priority || taskData.priority || 2,
            estimatedTotal: billing.estimatedTotal || 'Not available'
        };

        return Promise.all([
            this.emailSender(summary),
            this.smsSender(summary)
        ]);
    }
}

module.exports = Notifier;
module.exports.Notifier = Notifier;
