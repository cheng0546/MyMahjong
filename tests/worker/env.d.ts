declare module 'cloudflare:test' {
  import type { Env } from '../../worker/room';
  export const env: Env;
  export const SELF: Fetcher;
  export function runDurableObjectAlarm(stub: DurableObjectStub): Promise<boolean>;
}
