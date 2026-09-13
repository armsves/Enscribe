/** Parse a fetch Response as JSON, with a clear error if the body is plain text/HTML. */
export async function readApiJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) {
    if (!res.ok) {
      throw new Error(`Request failed (${res.status}) with empty body`);
    }
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(
      res.ok
        ? `Server returned non-JSON: ${snippet}`
        : `Request failed (${res.status}): ${snippet}`,
    );
  }
}
