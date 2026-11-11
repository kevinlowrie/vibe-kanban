/** Sanitized operator-readonly projection. This is NOT an authorization grant. */
export type DeploymentStatus =
  'healthy' | 'degraded' | 'unavailable' | 'unknown';
export interface OperatorProjection {
  observed_at: string;
  provenance: string;
  stale: boolean;
  items: {
    deployment_id: string;
    display_name: string;
    status: DeploymentStatus;
  }[];
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    throw new Error('Invalid operator projection');
  return value as Record<string, unknown>;
}
function bounded(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error('Invalid operator projection');
  return value;
}
export function parseOperatorProjection(
  value: unknown,
  now = Date.now()
): OperatorProjection {
  const source = exact(value, ['observed_at', 'provenance', 'stale', 'items']);
  const observed = bounded(source.observed_at, 40);
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(
    observed
  );
  const timestamp = Date.parse(observed);
  if (
    !match ||
    !Number.isFinite(timestamp) ||
    timestamp > now ||
    new Date(timestamp).toISOString() !==
      `${match[1]}.${(match[2] ?? '').padEnd(3, '0').slice(0, 3)}Z` ||
    typeof source.stale !== 'boolean' ||
    !Array.isArray(source.items) ||
    source.items.length > 1000
  )
    throw new Error('Invalid operator projection');
  const seen = new Set<string>();
  return {
    observed_at: observed,
    provenance: bounded(source.provenance, 200),
    stale: source.stale,
    items: source.items.map((value) => {
      const item = exact(value, ['deployment_id', 'display_name', 'status']);
      const identifier = bounded(item.deployment_id, 128);
      if (
        !/^[a-zA-Z0-9_-]{1,128}$/.test(identifier) ||
        seen.has(identifier) ||
        typeof item.status !== 'string' ||
        !['healthy', 'degraded', 'unavailable', 'unknown'].includes(
          String(item.status)
        )
      )
        throw new Error('Invalid operator projection');
      seen.add(identifier);
      return {
        deployment_id: identifier,
        display_name: bounded(item.display_name, 160),
        status: item.status as DeploymentStatus,
      };
    }),
  };
}
export function projectionIsStale(
  value: OperatorProjection,
  now = Date.now()
): boolean {
  const timestamp = Date.parse(value.observed_at);
  return (
    value.stale ||
    !Number.isFinite(timestamp) ||
    timestamp > now ||
    now >= timestamp + 300_000
  );
}
