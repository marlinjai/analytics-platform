import { COMPRESS_THRESHOLD_BYTES } from './constants';

export interface CompressedPayload {
  body: BodyInit;
  compressed: boolean;
}

/**
 * Compress a JSON string with gzip if the browser supports CompressionStream
 * and the payload exceeds the threshold. Falls back to uncompressed otherwise.
 */
export async function compressPayload(json: string): Promise<CompressedPayload> {
  if (
    json.length < COMPRESS_THRESHOLD_BYTES ||
    typeof CompressionStream === 'undefined'
  ) {
    return { body: json, compressed: false };
  }

  try {
    const stream = new Blob([json])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));

    const compressed = await new Response(stream).blob();
    return { body: compressed, compressed: true };
  } catch {
    // Compression failed — send uncompressed
    return { body: json, compressed: false };
  }
}
