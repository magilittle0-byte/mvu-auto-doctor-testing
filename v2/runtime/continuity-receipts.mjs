export function buildContinuitySourcePlan({
    messages,
    fromIndex = 0,
    toIndex,
} = {}) {
    const list = Array.isArray(messages) ? messages : [];
    const end = Number.isInteger(Number(toIndex))
        ? Math.min(list.length - 1, Number(toIndex))
        : list.length - 1;
    const start = Math.max(0, Number(fromIndex) || 0);
    const receipts = [];
    const eligibleIndexes = [];
    const skippedIndexes = [];
    for (let index = start; index <= end; index += 1) {
        const message = list[index];
        if (
            !message
            || message.is_user
            || message.is_system
            || typeof message.mes !== 'string'
            || !message.mes.trim()
        ) continue;
        eligibleIndexes.push(index);
        receipts.push({
            sourceIndex: index,
            decision: 'eligible',
        });
    }
    return {
        eligibleIndexes,
        skippedIndexes,
        eligibleCount: eligibleIndexes.length,
        skippedCount: skippedIndexes.length,
        receipts,
    };
}
