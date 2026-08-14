const SHA256_CONSTANTS = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
}

function sha256Hex(bytes) {
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const bitLengthHigh = Math.floor(bytes.length / 0x20000000);
    const bitLengthLow = (bytes.length << 3) >>> 0;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, bitLengthHigh, false);
    view.setUint32(paddedLength - 4, bitLengthLow, false);
    const hash = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const words = new Uint32Array(64);
    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let index = 0; index < 16; index += 1) {
            words[index] = view.getUint32(offset + (index * 4), false);
        }
        for (let index = 16; index < 64; index += 1) {
            const left = words[index - 15];
            const right = words[index - 2];
            const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
            const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
            words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = hash;
        for (let index = 0; index < 64; index += 1) {
            const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choice = (e & f) ^ ((~e) & g);
            const temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
            const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temporary2 = (sum0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temporary1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temporary1 + temporary2) >>> 0;
        }
        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }
    return [...hash]
        .map((value) => value.toString(16).padStart(8, '0'))
        .join('');
}

export function contentAddressedJsonRefFromText(json) {
    const source = new TextEncoder().encode(String(json));
    return `JSON-SHA256-V1-${source.length}-${sha256Hex(source)}`;
}

export function canonicalJsonStringify(value) {
    const ancestors = new Set();
    const encode = (input, inArray = false) => {
        const resolved = input && typeof input === 'object' && typeof input.toJSON === 'function'
            ? input.toJSON()
            : input;
        if (resolved === null) return 'null';
        if (typeof resolved === 'string') return JSON.stringify(resolved);
        if (typeof resolved === 'number') return Number.isFinite(resolved)
            ? JSON.stringify(resolved)
            : 'null';
        if (typeof resolved === 'boolean') return resolved ? 'true' : 'false';
        if (typeof resolved === 'bigint') {
            throw new TypeError('Do not know how to serialize a BigInt');
        }
        if (['undefined', 'function', 'symbol'].includes(typeof resolved)) {
            return inArray ? 'null' : undefined;
        }
        if (ancestors.has(resolved)) {
            throw new TypeError('Converting circular structure to JSON');
        }
        ancestors.add(resolved);
        let output;
        if (Array.isArray(resolved)) {
            output = `[${resolved.map((item) => encode(item, true)).join(',')}]`;
        } else {
            output = `{${Object.keys(resolved).sort().flatMap((key) => {
                const encoded = encode(resolved[key], false);
                return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`];
            }).join(',')}}`;
        }
        ancestors.delete(resolved);
        return output;
    };
    return encode(value, false);
}

export function contentAddressedJsonRef(value) {
    return contentAddressedJsonRefFromText(canonicalJsonStringify(value));
}

function bytesToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

export async function encodeContentAddressedJson(value) {
    const json = canonicalJsonStringify(value);
    if (json === undefined) {
        throw new TypeError('Checkpoint payload is not JSON serializable');
    }
    const source = new TextEncoder().encode(json);
    const ref = contentAddressedJsonRefFromText(json);
    if (typeof CompressionStream !== 'function') {
        return {
            ref,
            blob: {
                encoding: 'json',
                data: json,
                originalBytes: source.length,
                storedBytes: source.length,
            },
        };
    }
    const compressed = new Uint8Array(await new Response(
        new Blob([source]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer());
    return {
        ref,
        blob: {
            encoding: 'gzip-base64',
            data: bytesToBase64(compressed),
            originalBytes: source.length,
            storedBytes: compressed.length,
        },
    };
}

export async function decodeContentAddressedJson(ref, blob) {
    if (!blob || typeof blob !== 'object') throw new Error('checkpoint_blob_missing');
    let json = '';
    if (blob.encoding === 'json') {
        json = String(blob.data || '');
    } else if (blob.encoding === 'gzip-base64' && typeof DecompressionStream === 'function') {
        // K1 修复：截断/损坏的 base64 或 gzip 负载会让 DecompressionStream 抛出
        // 底层原始错误（如 "unexpected end of file"），调用方无法区分"数据损坏"
        // 与"格式问题"。统一归一为领域化错误码，便于诊断与日志聚合。
        let raw;
        try {
            raw = base64ToBytes(blob.data);
        } catch {
            throw new Error('checkpoint_blob_corrupt:base64');
        }
        // storedBytes 若被外部篡改且与实际不符，视为可疑损坏并如实报错。
        if (
            Number.isFinite(blob.storedBytes)
            && blob.storedBytes !== raw.length
        ) {
            throw new Error('checkpoint_blob_corrupt:length_mismatch');
        }
        let decompressed;
        try {
            decompressed = await new Response(
                new Blob([raw]).stream()
                    .pipeThrough(new DecompressionStream('gzip')),
            ).arrayBuffer();
        } catch {
            throw new Error('checkpoint_blob_corrupt:gzip');
        }
        json = new TextDecoder().decode(decompressed);
    } else {
        throw new Error('checkpoint_encoding_unsupported');
    }
    const bytes = new TextEncoder().encode(json).length;
    const expected = contentAddressedJsonRefFromText(json);
    if (expected !== ref) throw new Error('checkpoint_digest_mismatch');
    return JSON.parse(json);
}

