export const isBeforeOpening = (opensAt?: string, now = Date.now()) =>
  !!opensAt && Date.parse(opensAt) > now;

export function latestOpening(...values: (string | undefined)[]): string | undefined {
  const dates = values.filter((v): v is string => !!v).map(Date.parse);
  return dates.length ? new Date(Math.max(...dates)).toISOString() : undefined;
}

export function localDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
