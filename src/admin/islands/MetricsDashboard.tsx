/** @jsxImportSource preact */
/**
 * Island: performance metrics dashboard — request latency percentiles,
 * error rates, memory, and slow queries. Auto-refreshes every 30s.
 * Talks to /admin/api/metrics.
 */

import { useState, useEffect, useCallback } from "preact/hooks";

interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/** Matches @dune/core's MetricsSnapshot (src/metrics/types.ts). */
interface MetricsSummary {
  ts: string;
  uptimeSeconds: number;
  requests: {
    total: number;
    errors: number;
    errorRate: number;
    latency: LatencyStats;
  };
  topRoutes: Array<{ route: string; requests: number; errors: number; latency: LatencyStats }>;
  memory: { heapUsed: number; heapTotal: number; rss: number };
  slowQueries: Array<{ ts: string; type: "collection" | "search"; query: string; durationMs: number }>;
}

interface Props {
  prefix: string;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms * 100) / 100}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function MetricsDashboard({ prefix }: Props) {
  const apiBase = `${prefix}/api`;

  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/metrics`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as MetricsSummary;
      setMetrics(d);
      setLastRefresh(new Date());
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  if (loading) return <div class="s-7f1b1911">Loading metrics…</div>;

  return (
    <div class="metrics-wrap">
      {/* Toolbar */}
      <div class="s-2971273c">
        <button type="button" class="btn btn-sm btn-outline" onClick={load}>↻ Refresh</button>
        <label class="s-1b859768">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh((e.target as HTMLInputElement).checked)}
          />
          Auto-refresh (30s)
        </label>
        {lastRefresh && (
          <span class="s-ace205ad">
            Last updated: {lastRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && <div class="alert alert-error s-9590f79e">{error}</div>}

      {metrics && (
        <>
          {/* Summary cards */}
          <div class="metrics-cards s-eda77236">
            <MetricCard label="Requests" value={String(metrics.requests.total)} sub={`${metrics.requests.errors} errors`} />
            <MetricCard
              label="Error rate"
              value={`${(metrics.requests.errorRate * 100).toFixed(1)}%`}
              highlight={metrics.requests.errorRate > 0.05}
            />
            <MetricCard label="p50 latency" value={fmtMs(metrics.requests.latency.p50)} />
            <MetricCard label="p95 latency" value={fmtMs(metrics.requests.latency.p95)} highlight={metrics.requests.latency.p95 > 1000} />
            <MetricCard label="p99 latency" value={fmtMs(metrics.requests.latency.p99)} highlight={metrics.requests.latency.p99 > 2000} />
            <MetricCard label="Heap used" value={fmtBytes(metrics.memory.heapUsed)} sub={`of ${fmtBytes(metrics.memory.heapTotal)}`} />
            <MetricCard label="RSS" value={fmtBytes(metrics.memory.rss)} />
            <MetricCard label="Uptime" value={fmtUptime(metrics.uptimeSeconds)} />
          </div>

          {/* Latency bar chart */}
          <div class="s-df2a69f4">
            <h4>Latency distribution</h4>
            <div class="s-f1fe5575">
              {[
                { label: "p50", value: metrics.requests.latency.p50 },
                { label: "p95", value: metrics.requests.latency.p95 },
                { label: "p99", value: metrics.requests.latency.p99 },
              ].map(({ label, value }) => {
                const maxMs = Math.max(metrics.requests.latency.p99, 100);
                const pct = Math.min(100, (value / maxMs) * 100);
                const bucket = value > 1000 ? "bar-fill-danger" : value > 500 ? "bar-fill-warn" : "bar-fill-ok";
                return (
                  <div key={label} class="s-f53c0fbe">
                    <span class="s-d8241069">{label}</span>
                    <div class="bar-track">
                      {/* Genuinely per-render dynamic value — still a raw style
                          attribute, still blocked by the useNonce CSP. Needs a
                          scoped nonce'd <style> element to fix properly; not
                          addressed here. */}
                      <div class={`bar-fill ${bucket}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span class="s-85a4ef6b">{fmtMs(value)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Slowest routes */}
          {metrics.topRoutes.length > 0 && (
            <div class="s-df2a69f4">
              <h4>Slowest routes</h4>
              <table class="admin-table s-4dd59aa6">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th>p50</th>
                    <th>Requests</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.topRoutes.map((r) => (
                    <tr key={r.route}>
                      <td><code>{r.route}</code></td>
                      <td class={r.latency.p50 > 1000 ? "text-danger" : undefined}>{fmtMs(r.latency.p50)}</td>
                      <td>{r.requests}</td>
                      <td>{r.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent slow queries */}
          {metrics.slowQueries.length > 0 && (
            <div class="s-df2a69f4">
              <h4>Recent slow queries</h4>
              <table class="admin-table s-4dd59aa6">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Query</th>
                    <th>Duration</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.slowQueries.map((q, i) => (
                    <tr key={i}>
                      <td>{q.type}</td>
                      <td><code>{q.query}</code></td>
                      <td class={q.durationMs > 1000 ? "text-danger" : undefined}>{fmtMs(q.durationMs)}</td>
                      <td>{new Date(q.ts).toLocaleTimeString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div class={`metric-card${highlight ? " metric-card-highlight" : ""}`}>
      <div class="s-5b4cfbc9">{label}</div>
      <div class={`metric-card-value${highlight ? " metric-card-value-highlight" : ""}`}>{value}</div>
      {sub && <div class="s-01282aa4">{sub}</div>}
    </div>
  );
}
