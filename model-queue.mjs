function abortError(reason = '模型任务已取消') {
    const error = new Error(String(reason || '模型任务已取消'));
    error.name = 'AbortError';
    return error;
}

function normalizedPriority(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function normalizedConcurrency(value) {
    const number = Math.floor(Number(value) || 1);
    return Math.min(8, Math.max(1, number));
}

export function nextModelRouteHealth(currentValue, {
    succeeded = false,
    failureKind = '',
    now = Date.now(),
    cooldownMs = 5 * 60 * 1000,
} = {}) {
    const current = currentValue && typeof currentValue === 'object'
        ? currentValue
        : {};
    const currentFailures = Math.max(
        0,
        Math.floor(Number(current.consecutiveFailures) || 0),
    );
    if (succeeded) {
        return {
            ...current,
            consecutiveFailures: 0,
            openedUntil: 0,
            lastSuccessAt: Number(now) || 0,
            lastFailureKind: '',
        };
    }
    const normalizedFailureKind = String(failureKind || 'transport-error');
    // The connection successfully returned a model answer when a module-level
    // validator rejected its shape or content. That is a repairable task
    // problem, not evidence that the API/model slot is unhealthy.
    if (normalizedFailureKind === 'validation-error') {
        return {
            ...current,
            lastValidationAt: Number(now) || 0,
        };
    }
    const semanticPoison = normalizedFailureKind === 'parse-error';
    const consecutiveFailures = currentFailures + 1;
    return {
        ...current,
        consecutiveFailures,
        openedUntil: semanticPoison || consecutiveFailures >= 2
            ? Math.max(
                Number(current.openedUntil) || 0,
                (Number(now) || 0) + Math.max(1, Number(cooldownMs) || 0),
            )
            : Number(current.openedUntil) || 0,
        lastFailureAt: Number(now) || 0,
        lastFailureKind: normalizedFailureKind,
    };
}

export function countDistinctFailoverReservations({
    maxFailovers = 0,
    attemptedCount = 0,
    currentSlotIndex = -1,
    currentKey = '',
    attemptedSlots = [],
    attemptedKeys = [],
    routes = [],
    now = Date.now(),
} = {}) {
    const remainingLimit = Math.max(
        0,
        Math.floor(Number(maxFailovers) || 0)
            - Math.max(0, Math.floor(Number(attemptedCount) || 0)),
    );
    if (!remainingLimit) return 0;
    const blockedSlots = new Set(
        (Array.isArray(attemptedSlots) ? attemptedSlots : []).map(Number),
    );
    const blockedKeys = new Set([
        ...(Array.isArray(attemptedKeys) ? attemptedKeys : []).map(String),
        String(currentKey || ''),
    ]);
    const healthyKeys = new Set(
        (Array.isArray(routes) ? routes : [])
            .filter((route) => (
                Number(route?.slotIndex) !== Number(currentSlotIndex)
                && !blockedSlots.has(Number(route?.slotIndex))
                && Number(route?.openedUntil || 0) <= Number(now)
                && !blockedKeys.has(String(route?.key || ''))
            ))
            .map((route) => String(route?.key || ''))
            .filter(Boolean),
    );
    return Math.min(remainingLimit, healthyKeys.size);
}

export class ConnectionTaskScheduler {
    constructor({
        agingIntervalMs = 5_000,
        maxPriorityBoost = 60,
        now = () => Date.now(),
    } = {}) {
        this.connections = new Map();
        this.sequence = 0;
        this.agingIntervalMs = Math.max(250, Number(agingIntervalMs) || 5_000);
        this.maxPriorityBoost = Math.max(0, Number(maxPriorityBoost) || 60);
        this.now = typeof now === 'function' ? now : () => Date.now();
    }

    enqueue(connectionKey, run, {
        priority = 0,
        signal = null,
        label = '',
        maxConcurrent = 1,
    } = {}) {
        if (typeof run !== 'function') {
            return Promise.reject(new TypeError('模型连接队列缺少可执行任务'));
        }
        if (signal?.aborted) {
            return Promise.reject(abortError(signal.reason));
        }

        const key = String(connectionKey || 'default');
        const state = this.connections.get(key) || {
            activeCount: 0,
            activeLabels: new Map(),
            maxConcurrent: normalizedConcurrency(maxConcurrent),
            pending: [],
        };
        state.maxConcurrent = normalizedConcurrency(maxConcurrent);
        this.connections.set(key, state);

        return new Promise((resolve, reject) => {
            const entry = {
                run,
                resolve,
                reject,
                priority: normalizedPriority(priority),
                sequence: this.sequence += 1,
                signal,
                label: String(label || ''),
                abortListener: null,
                enqueuedAt: this.now(),
            };
            if (signal?.addEventListener) {
                entry.abortListener = () => {
                    const index = state.pending.indexOf(entry);
                    if (index < 0) return;
                    state.pending.splice(index, 1);
                    reject(abortError(signal.reason));
                    this.cleanup(key, state);
                };
                signal.addEventListener('abort', entry.abortListener, { once: true });
            }
            state.pending.push(entry);
            this.drain(key, state);
        });
    }

    snapshot() {
        return [...this.connections.entries()].map(([key, state]) => ({
            key,
            active: state.activeCount > 0,
            activeCount: state.activeCount,
            activeLabel: [...state.activeLabels.values()][0]?.label || '',
            activeLabels: [...state.activeLabels.values()].map((entry) => entry.label),
            activeDurationMs: Math.max(0, ...[...state.activeLabels.values()]
                .map((entry) => this.now() - entry.startedAt)),
            maxConcurrent: state.maxConcurrent,
            oldestPendingMs: Math.max(0, ...state.pending
                .map((entry) => this.now() - entry.enqueuedAt)),
            pending: [...state.pending].sort((left, right) => (
                this.effectivePriority(right) - this.effectivePriority(left)
                || left.sequence - right.sequence
            )).map((entry) => ({
                label: entry.label,
                priority: entry.priority,
                effectivePriority: this.effectivePriority(entry),
                waitingMs: Math.max(0, this.now() - entry.enqueuedAt),
            })),
        }));
    }

    effectivePriority(entry) {
        const waited = Math.max(0, this.now() - entry.enqueuedAt);
        const boost = Math.min(
            this.maxPriorityBoost,
            Math.floor(waited / this.agingIntervalMs),
        );
        return entry.priority + boost;
    }

    takeNext(state) {
        state.pending.sort((left, right) => (
            this.effectivePriority(right) - this.effectivePriority(left)
            || left.sequence - right.sequence
        ));
        return state.pending.shift();
    }

    cleanup(key, state) {
        if (state.activeCount === 0 && !state.pending.length) this.connections.delete(key);
    }

    drain(key, state) {
        while (state.activeCount < state.maxConcurrent && state.pending.length) {
            const entry = this.takeNext(state);
            if (entry.abortListener && entry.signal?.removeEventListener) {
                entry.signal.removeEventListener('abort', entry.abortListener);
            }
            if (entry.signal?.aborted) {
                entry.reject(abortError(entry.signal.reason));
                continue;
            }

            state.activeCount += 1;
            state.activeLabels.set(entry.sequence, {
                label: entry.label,
                startedAt: this.now(),
            });
            Promise.resolve()
                .then(entry.run)
                .then((value) => {
                    state.activeCount -= 1;
                    state.activeLabels.delete(entry.sequence);
                    this.drain(key, state);
                    entry.resolve(value);
                }, (error) => {
                    state.activeCount -= 1;
                    state.activeLabels.delete(entry.sequence);
                    this.drain(key, state);
                    entry.reject(error);
                });
        }
        this.cleanup(key, state);
    }
}
