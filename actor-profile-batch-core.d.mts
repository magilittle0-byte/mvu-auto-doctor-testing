export interface ActorProfileBatchTransactionResult {
    ledger: Record<string, unknown>;
    candidates: object[];
    accepted: object[];
    rejected: object[];
    failures: object[];
    persistenceMeta: object | null;
    modelCalls: number;
}

export function completeActorProfileBatchTransaction(options?: object): Promise<ActorProfileBatchTransactionResult>;
