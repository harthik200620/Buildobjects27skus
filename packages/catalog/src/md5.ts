import { createHash } from 'node:crypto';

/**
 * MD5, for directory sharding and nothing else — `shard()` in media.ts is the only caller.
 *
 * This was sixty-seven lines of RFC 1321 in TypeScript, written to be isomorphic so a media key
 * could be derived in a browser. Nothing derives one in a browser: every caller of `shard` and
 * `imageKey` is a route, a pipeline stage or a script.
 */
export function md5Hex(input: string): string {
  return createHash('md5').update(input).digest('hex');
}
