'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { CHART_SERIES_COLORS } from '@/lib/brand/colors'
import { formatCacheHitRate, formatCacheLatencyMs } from '@/lib/cache-metrics'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowUpIcon, ArrowDownIcon, Users, Calendar, TrendingUp } from 'lucide-react'

interface DailyStats {
  date: string
  dau: number
  wau: number
  mau: number
  dauWebDesktop: number
  dauWebIPhone: number
  dauWebAndroid: number
  dauIOSApp: number
  dauMacApp: number
  dauAPIOther: number
  dauUnknown: number
  taskCreated: number
  taskEdited: number
  taskCompleted: number
  taskDeleted: number
  commentAdded: number
  commentDeleted: number
  listAdded: number
  listEdited: number
  listDeleted: number
  settingsUpdated: number
}

interface AnalyticsSummary {
  date: string
  dau: number
  wau: number
  mau: number
  dauChange: number | null
  wauChange: number | null
  mauChange: number | null
  platformBreakdown: Record<string, number>
  eventCounts: Record<string, number>
}

interface EventsByPlatform {
  byPlatform: Record<string, Record<string, number>>
  totalsByEvent: Record<string, number>
  totalsByPlatform: Record<string, number>
  platformOrder: string[]
  eventOrder: string[]
}

/**
 * Redis cache numbers for the selected range (AWTD-905).
 *
 * `hitRate` and the two latencies are null when nothing was recorded — which is
 * a different fact from 0%, and has to render differently. Both latencies are
 * MEANS: the stored windows are summed durations, and no percentile is
 * recoverable from a sum, so the labels say "mean" rather than borrowing the
 * percentile wording the other rows of PERFORMANCE_BUDGETS.md use.
 */
interface CacheMetricsSummary {
  hits: number
  misses: number
  lookups: number
  loads: number
  coalesced: number
  errors: number
  windows: number
  instances: number
  hitRate: number | null
  meanLookupMs: number | null
  meanLoadMs: number | null
}

interface CacheMetricsDay extends CacheMetricsSummary {
  date: string
}

interface CacheMetricsReport {
  totals: CacheMetricsSummary
  byDay: CacheMetricsDay[]
  retentionDays: number
}

interface AnalyticsData {
  stats: DailyStats[]
  summary: AnalyticsSummary | null
  eventsByPlatform?: EventsByPlatform
  cache?: CacheMetricsReport
  meta: {
    startDate: string
    endDate: string
    totalDays: number
  }
}

// Friendly labels for the per-interface breakdown.
const PLATFORM_LABELS: Record<string, string> = {
  'web-desktop': 'Desktop Web',
  'web-iPhone': 'iPhone Web',
  'web-android': 'Android Web',
  'iOS-app': 'iOS App',
  'API-other': 'API',
  unknown: 'Unknown',
}

const EVENT_LABELS: Record<string, string> = {
  task_created: 'Tasks Created',
  task_completed: 'Tasks Completed',
  task_edited: 'Tasks Edited',
  task_deleted: 'Tasks Deleted',
  comment_added: 'Comments Added',
  comment_deleted: 'Comments Deleted',
  list_added: 'Lists Added',
  list_edited: 'Lists Edited',
  list_deleted: 'Lists Deleted',
  settings_updated: 'Settings Updated',
}

const labelFor = (map: Record<string, string>, key: string) =>
  map[key] ||
  key.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** A tile for a value that may not exist yet — MetricCard takes a number. */
function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function MetricCard({
  title,
  value,
  change,
  icon: Icon,
}: {
  title: string
  value: number
  change: number | null
  icon: React.ElementType
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value.toLocaleString()}</div>
        {change !== null && (
          <p className={`text-xs ${change >= 0 ? 'text-green-600' : 'text-red-600'} flex items-center`}>
            {change >= 0 ? <ArrowUpIcon className="h-3 w-3 mr-1" /> : <ArrowDownIcon className="h-3 w-3 mr-1" />}
            {Math.abs(change)}% from yesterday
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export default function AnalyticsDashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState(30)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const endDate = new Date()
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - dateRange)

      const response = await fetch(
        `/api/admin/analytics?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`
      )

      if (response.status === 403) {
        setError('You do not have admin access to view analytics.')
        return
      }

      if (!response.ok) {
        throw new Error('Failed to fetch analytics')
      }

      const result = await response.json()
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [dateRange])

  useEffect(() => {
    if (status === 'loading') return
    if (!session) {
      router.push('/auth/signin')
      return
    }
    fetchData()
  }, [session, status, router, fetchData])

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="text-red-800 font-semibold">Access Denied</h2>
          <p className="text-red-600">{error}</p>
          <Button variant="outline" className="mt-4" onClick={() => router.push('/')}>
            Go Home
          </Button>
        </div>
      </div>
    )
  }

  if (!data) return null

  // Prepare chart data
  const chartData = data.stats.map((stat) => ({
    date: new Date(stat.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    DAU: stat.dau,
    WAU: stat.wau,
    MAU: stat.mau,
  }))

  // Platform trend data for DAU breakdown over time
  const platformTrendData = data.stats.map((stat) => ({
    date: new Date(stat.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    'Desktop Web': stat.dauWebDesktop,
    'iPhone Web': stat.dauWebIPhone,
    'Android Web': stat.dauWebAndroid,
    'iOS App': stat.dauIOSApp,
    'Mac App': stat.dauMacApp,
    API: stat.dauAPIOther,
    Unknown: stat.dauUnknown,
  }))

  // Check if there's any platform data
  const hasPlatformData = data.stats.some(
    (stat) =>
      stat.dauWebDesktop > 0 ||
      stat.dauWebIPhone > 0 ||
      stat.dauWebAndroid > 0 ||
      stat.dauIOSApp > 0 ||
      stat.dauMacApp > 0 ||
      stat.dauAPIOther > 0 ||
      stat.dauUnknown > 0
  )

  // Event counts for bar chart
  const eventData = data.summary
    ? [
        { name: 'Tasks Created', value: data.summary.eventCounts.taskCreated },
        { name: 'Tasks Completed', value: data.summary.eventCounts.taskCompleted },
        { name: 'Tasks Edited', value: data.summary.eventCounts.taskEdited },
        { name: 'Comments Added', value: data.summary.eventCounts.commentAdded },
        { name: 'Lists Added', value: data.summary.eventCounts.listAdded },
      ]
    : []

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold truncate">Analytics Dashboard</h1>
            <p className="text-sm text-muted-foreground truncate">User activity and engagement metrics</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(Number(e.target.value))}
            className="border rounded-md px-3 py-2 text-sm flex-1 sm:flex-none min-w-0"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <MetricCard
          title="Daily Active Users"
          value={data.summary?.dau || 0}
          change={data.summary?.dauChange ?? null}
          icon={Users}
        />
        <MetricCard
          title="Weekly Active Users"
          value={data.summary?.wau || 0}
          change={data.summary?.wauChange ?? null}
          icon={Calendar}
        />
        <MetricCard
          title="Monthly Active Users"
          value={data.summary?.mau || 0}
          change={data.summary?.mauChange ?? null}
          icon={TrendingUp}
        />
      </div>

      {/* Trend Chart */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>User Activity Trends</CardTitle>
          <CardDescription>DAU, WAU, and MAU over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="DAU" stroke={CHART_SERIES_COLORS[0]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="WAU" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="MAU" stroke="#8b5cf6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Platform Trends */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>DAU by Platform</CardTitle>
          <CardDescription>Daily active users breakdown by platform over time</CardDescription>
        </CardHeader>
        <CardContent>
          {hasPlatformData ? (
            <div className="h-[220px] sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={platformTrendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="Desktop Web" stroke={CHART_SERIES_COLORS[0]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="iPhone Web" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Android Web" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="iOS App" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="API" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Unknown" stroke="#6b7280" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[220px] sm:h-[300px] flex items-center justify-center text-muted-foreground">
              No platform data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event Activity */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Event Activity</CardTitle>
          <CardDescription>Actions performed today</CardDescription>
        </CardHeader>
        <CardContent>
          {eventData.some((e) => e.value > 0) ? (
            <div className="h-[200px] sm:h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={eventData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={100} />
                  <Tooltip />
                  <Bar dataKey="value" fill={CHART_SERIES_COLORS[0]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[200px] sm:h-[250px] flex items-center justify-center text-muted-foreground">
              No events recorded today
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event Activity by Interface */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Metrics by Interface</CardTitle>
          <CardDescription>
            All events over the selected period, broken down by interface (web, mobile web, iOS, …)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const ebp = data.eventsByPlatform
            if (!ebp) {
              return (
                <div className="text-sm text-muted-foreground">No interface data available</div>
              )
            }
            // Only show platforms that actually had activity, but always keep
            // a stable column order. Fall back to all platforms if none active.
            const activePlatforms = ebp.platformOrder.filter(
              (p) => (ebp.totalsByPlatform[p] || 0) > 0
            )
            const platforms = activePlatforms.length > 0 ? activePlatforms : ebp.platformOrder
            const grandTotal = platforms.reduce(
              (sum, p) => sum + (ebp.totalsByPlatform[p] || 0),
              0
            )

            if (grandTotal === 0) {
              return (
                <div className="text-sm text-muted-foreground">
                  No events recorded in this period
                </div>
              )
            }

            return (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="metrics-by-interface-table">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 font-medium">Metric</th>
                      {platforms.map((p) => (
                        <th key={p} className="text-right py-2 px-2 font-medium whitespace-nowrap">
                          {labelFor(PLATFORM_LABELS, p)}
                        </th>
                      ))}
                      <th className="text-right py-2 px-2 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ebp.eventOrder.map((eventType) => (
                      <tr key={eventType} className="border-b">
                        <td className="py-2 px-2 whitespace-nowrap">
                          {labelFor(EVENT_LABELS, eventType)}
                        </td>
                        {platforms.map((p) => (
                          <td key={p} className="text-right py-2 px-2 tabular-nums">
                            {(ebp.byPlatform[p]?.[eventType] || 0).toLocaleString()}
                          </td>
                        ))}
                        <td className="text-right py-2 px-2 font-medium tabular-nums">
                          {(ebp.totalsByEvent[eventType] || 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2">
                      <td className="py-2 px-2 font-semibold">Total</td>
                      {platforms.map((p) => (
                        <td key={p} className="text-right py-2 px-2 font-semibold tabular-nums">
                          {(ebp.totalsByPlatform[p] || 0).toLocaleString()}
                        </td>
                      ))}
                      <td className="text-right py-2 px-2 font-semibold tabular-nums">
                        {grandTotal.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          })()}
        </CardContent>
      </Card>

      {/* Redis cache (AWTD-905) */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Redis Cache</CardTitle>
          <CardDescription>
            Hit rate and mean latency per day over the selected period. Latencies are means over
            every lookup and load, not percentiles — the stored windows are summed durations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const cache = data.cache
            if (!cache || cache.totals.windows === 0) {
              return (
                <div className="text-sm text-muted-foreground" data-testid="cache-empty">
                  No cache windows recorded in this period. Each serverless instance reports one
                  window a minute while it is serving traffic, so this fills in once a build
                  carrying the reporter is live.
                </div>
              )
            }

            const { totals } = cache
            const trend = cache.byDay.map((day) => ({
              date: new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              }),
              'Hit rate %': day.hitRate === null ? null : Number(day.hitRate.toFixed(2)),
              'Mean lookup ms': day.meanLookupMs === null ? null : Number(day.meanLookupMs.toFixed(2)),
              'Mean load ms': day.meanLoadMs === null ? null : Number(day.meanLoadMs.toFixed(2)),
            }))

            return (
              <div className="space-y-4" data-testid="cache-section">
                <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                  <StatTile
                    label="Hit rate"
                    value={formatCacheHitRate(totals.hitRate)}
                    hint="budget: ≥ 80% warm"
                  />
                  <StatTile
                    label="Mean lookup"
                    value={formatCacheLatencyMs(totals.meanLookupMs)}
                    hint="Redis round trip"
                  />
                  <StatTile
                    label="Mean load"
                    value={formatCacheLatencyMs(totals.meanLoadMs)}
                    hint="what a miss pays"
                  />
                  <StatTile
                    label="Lookups"
                    value={totals.lookups.toLocaleString()}
                    hint={`${totals.instances.toLocaleString()} instance${totals.instances === 1 ? '' : 's'} reporting`}
                  />
                </div>

                <div className="h-[220px] sm:h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                      {/* Two axes: a percentage and a duration do not share a scale. */}
                      <YAxis yAxisId="rate" domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <YAxis yAxisId="ms" orientation="right" tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Line
                        yAxisId="rate"
                        type="monotone"
                        dataKey="Hit rate %"
                        stroke={CHART_SERIES_COLORS[0]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                      <Line
                        yAxisId="ms"
                        type="monotone"
                        dataKey="Mean lookup ms"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                      <Line
                        yAxisId="ms"
                        type="monotone"
                        dataKey="Mean load ms"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <p className="text-xs text-muted-foreground">
                  {totals.hits.toLocaleString()} hits, {totals.misses.toLocaleString()} misses,{' '}
                  {totals.loads.toLocaleString()} loads, {totals.coalesced.toLocaleString()} coalesced,{' '}
                  {totals.errors.toLocaleString()} errors over {totals.windows.toLocaleString()}{' '}
                  windows. Windows are kept {cache.retentionDays} days, so a range wider than that
                  reads short at its oldest end.
                </p>
              </div>
            )
          })()}
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Metrics</CardTitle>
          <CardDescription>Raw daily statistics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-right py-2 px-2">DAU</th>
                  <th className="text-right py-2 px-2">WAU</th>
                  <th className="text-right py-2 px-2">MAU</th>
                  <th className="text-right py-2 px-2">Tasks</th>
                  <th className="text-right py-2 px-2">Comments</th>
                </tr>
              </thead>
              <tbody>
                {data.stats
                  .slice()
                  .reverse()
                  .slice(0, 10)
                  .map((stat) => (
                    <tr key={stat.date} className="border-b">
                      <td className="py-2 px-2">
                        {new Date(stat.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="text-right py-2 px-2">{stat.dau}</td>
                      <td className="text-right py-2 px-2">{stat.wau}</td>
                      <td className="text-right py-2 px-2">{stat.mau}</td>
                      <td className="text-right py-2 px-2">{stat.taskCreated + stat.taskCompleted}</td>
                      <td className="text-right py-2 px-2">{stat.commentAdded}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
