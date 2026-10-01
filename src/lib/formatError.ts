// supabase-js kaster ikke Error-instanser: `error` fra et mislykket kall er et
// vanlig PostgrestError-objekt ({ message, details, hint, code }). Et
// `err instanceof Error ? err.message : String(err)` gir derfor
// "[object Object]" i stedet for den faktiske feilteksten.
export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const { message, details, hint } = err as Record<string, unknown>;
    if (typeof message === 'string' && message) {
      const extra = [details, hint].filter((s): s is string => typeof s === 'string' && s !== '');
      return extra.length ? `${message} (${extra.join(' — ')})` : message;
    }
  }
  return String(err);
}
