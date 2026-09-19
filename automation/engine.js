const DispatchStorage = require('../data/storage');
const BillingWorker = require('../workers/billingWorker');
const ComplianceWorker = require('../workers/complianceWorker');
const Notifier = require('../utils/notifier');
const AutomationQueue = require('./queue');
const RagEngine = require('./ragEngine');

class AutomationEngine {
    constructor(
        pipeline,
        storage = new DispatchStorage(),
        billingWorker = new BillingWorker(),
        complianceWorker = new ComplianceWorker(),
        notifier = new Notifier(),
        queue = new AutomationQueue(),
        ragEngine = new RagEngine(storage.getDatabase())
    ) {
        if (typeof pipeline !== 'function') {
            throw new TypeError('AutomationEngine requires a pipeline function.');
        }

        this.pipeline = pipeline;
        this.storage = storage;
        this.billingWorker = billingWorker;
        this.complianceWorker = complianceWorker;
        this.notifier = notifier;
        this.queue = queue;
        this.ragEngine = ragEngine;
    }

    enqueue(...args) {
        return this.queue.enqueue(() => this.run(...args));
    }

    async run(...args) {
        const taskData = args[0] || {};
        const ragQuery = `${taskData.faultCode || ''} ${taskData.userQuestion || ''}`.trim();
        const oemReferencesUsed = ragQuery ? this.ragEngine.search(ragQuery) : [];
        const taskWithTechnicalContext = {
            ...taskData,
            oemTechnicalContext: oemReferencesUsed
                .map(reference => `[Manual: ${reference.source_manual} | Page ${reference.page_number}] ${reference.chunk_text}`)
                .join('\n\n')
        };
        const dispatchResult = await this.pipeline(taskWithTechnicalContext, ...args.slice(1));
        const [billing, compliance] = await Promise.all([
            this.billingWorker.process(taskWithTechnicalContext, dispatchResult),
            this.complianceWorker.process(taskWithTechnicalContext, dispatchResult)
        ]);
        const result = {
            ...dispatchResult,
            billing,
            compliance,
            oemReferencesUsed
        };

        this.storage.append({
            id: `AUTOMATION-${Date.now()}`,
            timestamp: new Date().toISOString(),
            status: 'completed',
            input: args.length === 1 ? taskWithTechnicalContext : [taskWithTechnicalContext, ...args.slice(1)],
            output: result
        });

        try {
            await this.notifier.notifyDispatch(taskWithTechnicalContext, dispatchResult, result);
        } catch (error) {
            console.error('Unable to send dispatch notifications:', error);
        }

        return result;
    }
}

module.exports = AutomationEngine;
module.exports.AutomationEngine = AutomationEngine;
