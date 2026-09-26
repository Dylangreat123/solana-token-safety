import { createSolanaRpc } from "@solana/kit";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Rate limits (429), server errors (5xx) and timeouts are worth retrying.
// Errors the RPC node returns about the request itself are not.
function isRetryable(err) {
  const status = err?.context?.statusCode ?? err?.context?.__serverMessage?.statusCode;
  if (typeof status === "number") return status === 429 || status >= 500;
  const msg = String(err?.message ?? "");
  if (/\((429|5\d\d)\)/.test(msg)) return true;
  return err?.name === "AbortError" || err?.name === "TimeoutError" || /fetch failed|ECONNRESET|ETIMEDOUT|aborted/i.test(msg);
}

/**
 * Wraps @solana/kit's RPC client with a per-call timeout and a small retry
 * budget, so one slow or rate-limited call doesn't hang a paid request.
 */
export function makeRpc(url, { timeoutMs = 8000, retries = 2 } = {}) {
  const rpc = createSolanaRpc(url);
  return {
    async call(build) {
      let lastErr;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await build(rpc).send({ abortSignal: AbortSignal.timeout(timeoutMs) });
        } catch (err) {
          lastErr = err;
          if (attempt === retries || !isRetryable(err)) break;
          await sleep(350 * 2 ** attempt);
        }
      }
      throw lastErr;
    },
  };
}
