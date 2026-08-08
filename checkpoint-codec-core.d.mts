export interface ContentAddressedJsonBlob {
    encoding: 'json' | 'gzip-base64';
    data: string;
    originalBytes: number;
    storedBytes: number;
}

export function contentAddressedJsonRef(value: unknown): string;

export function contentAddressedJsonRefFromText(json: string): string;

export function canonicalJsonStringify(value: unknown): string | undefined;

export function encodeContentAddressedJson(value: unknown): Promise<{
    ref: string;
    blob: ContentAddressedJsonBlob;
}>;

export function decodeContentAddressedJson(
    ref: string,
    blob: ContentAddressedJsonBlob,
): Promise<unknown>;
