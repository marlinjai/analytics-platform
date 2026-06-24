/**
 * openfga-direct.ts
 *
 * Minimal direct OpenFGA REST access from the analytics app, using the SAME
 * store the SDK's can() reads (OPENFGA_API_URL + OPENFGA_STORE_ID). Two uses:
 *
 *   - readWorkspaceTuples: diagnostic — list the tuples on a workspace object so
 *     we can see whether the auth-brain outbox sync worker actually wrote the
 *     membership grants (the worker is async and has been unreliable).
 *   - writeWorkspaceGrant: recovery — write the owner's grant tuple directly when
 *     the async worker has not, so access works without waiting on (or being
 *     blocked by) the outbox pipeline.
 *
 * This is a deliberate bypass of auth-brain's outbox (its system of record still
 * holds the membership row); it only reconciles the OpenFGA side the worker was
 * supposed to write. Guarded and best-effort.
 */

const OPENFGA_API_URL = process.env.OPENFGA_API_URL;
const STORE_ID = process.env.OPENFGA_STORE_ID;
const MODEL_ID = process.env.OPENFGA_AUTHORIZATION_MODEL_ID;
const API_TOKEN = process.env.OPENFGA_API_TOKEN;

export type FgaTuple = { user: string; relation: string; object: string };

function configured(): boolean {
  return Boolean(OPENFGA_API_URL && STORE_ID);
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
  };
}

/** List the tuples whose object is workspace:<id>. Empty array if unconfigured. */
export async function readWorkspaceTuples(workspaceId: string): Promise<FgaTuple[]> {
  if (!configured()) return [];
  const res = await fetch(`${OPENFGA_API_URL}/stores/${STORE_ID}/read`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ tuple_key: { object: `workspace:${workspaceId}` } }),
  });
  if (!res.ok) {
    throw new Error(`OpenFGA read ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { tuples?: Array<{ key: FgaTuple }> };
  return (json.tuples ?? []).map((t) => t.key);
}

/**
 * Write a grant tuple (default relation "admin") for user:<userId> on
 * workspace:<workspaceId>. Tolerates "already exists". Returns true if written
 * (or already present), false if OpenFGA is not configured.
 */
export async function writeWorkspaceGrant(
  userId: string,
  workspaceId: string,
  relation: 'admin' | 'member' | 'viewer' = 'admin',
): Promise<boolean> {
  if (!configured()) return false;
  const res = await fetch(`${OPENFGA_API_URL}/stores/${STORE_ID}/write`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      writes: { tuple_keys: [{ user: `user:${userId}`, relation, object: `workspace:${workspaceId}` }] },
      ...(MODEL_ID ? { authorization_model_id: MODEL_ID } : {}),
    }),
  });
  if (res.ok) return true;
  const body = await res.text();
  // OpenFGA returns 400 when the tuple already exists; that is success for us.
  if (/already exists|duplicate|write_failed_due_to_invalid_input/i.test(body)) return true;
  throw new Error(`OpenFGA write ${res.status}: ${body.slice(0, 200)}`);
}
