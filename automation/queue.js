const { EventEmitter } = require('events');

class AutomationQueue extends EventEmitter {
    constructor({ concurrency = 1 } = {}) {
        if (!Number.isInteger(concurrency) || concurrency < 1) {
            throw new TypeError('Queue concurrency must be a positive integer.');
        }

        super();
        this.concurrency = concurrency;
        this.pending = [];
        this.activeCount = 0;
        this.nextId = 1;
    }

    enqueue(task) {
        if (typeof task !== 'function') {
            throw new TypeError('Automation queue task must be a function.');
        }

        const id = `job-${this.nextId++}`;
        const promise = new Promise((resolve, reject) => {
            this.pending.push({ id, task, resolve, reject });
            this.emit('queued', { id });
            this.drain();
        });
        return { id, promise };
    }

    drain() {
        while (this.activeCount < this.concurrency && this.pending.length > 0) {
            const job = this.pending.shift();
            this.activeCount += 1;
            this.emit('started', { id: job.id });
            Promise.resolve()
                .then(job.task)
                .then(result => {
                    this.emit('completed', { id: job.id, result });
                    job.resolve(result);
                })
                .catch(error => {
                    this.emit('failed', { id: job.id, error });
                    job.reject(error);
                })
                .finally(() => {
                    this.activeCount -= 1;
                    this.drain();
                });
        }
    }
}

module.exports = AutomationQueue;
module.exports.AutomationQueue = AutomationQueue;
