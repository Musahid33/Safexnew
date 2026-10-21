/**
 * Resolve to `null` instead of hanging when a database call stalls.
 *
 * Every store needs this ceiling: without it one slow PostgREST request holds the route open
 * until the platform kills it and the screen spins forever. It lives here once because five
 * identical copies drifted apart the moment one of them was touched.
 */
export async function withTimeout<T>(work: PromiseLike<T>, timeoutMs = 5000): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    return await Promise.race([Promise.resolve(work), timeout]) as T | null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
