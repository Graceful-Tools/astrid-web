"use client"

/**
 * The Insights tab in List Settings (AWTD-1329). Renders GET /api/v1/lists/:id/insights — the
 * numbers are computed on the server (lib/list-insights.ts), so this only draws them.
 */

import React, { useEffect, useState } from "react"
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Bot } from "lucide-react"
import { ProfileImage, getInitials } from "@/components/ui/profile-image"
import { useTranslations } from "@/lib/i18n/client"
import { apiGet } from "@/lib/api"
import { CHART_SERIES_COLORS } from "@/lib/brand/colors"
import {
  DEFAULT_INSIGHT_WINDOW_DAYS,
  INSIGHT_WINDOW_DAYS,
  type InsightDuration,
  type InsightWindowDays,
  type ListInsights,
} from "@/lib/list-insights"

type Translate = ReturnType<typeof useTranslations>["t"]

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A duration at the one unit that reads naturally: minutes under an hour, hours under two days. */
export function formatInsightDuration(ms: number, t: Translate): string {
  if (ms < HOUR) return t("listInsights.duration.minutes", { n: String(Math.max(1, Math.round(ms / MINUTE))) })
  if (ms < 2 * DAY) return t("listInsights.duration.hours", { n: String(Math.round((ms / HOUR) * 10) / 10) })
  return t("listInsights.duration.days", { n: String(Math.round((ms / DAY) * 10) / 10) })
}

function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

function DurationStat({ label, value, t }: { label: string; value: InsightDuration; t: Translate }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-sm theme-text-secondary">{label}</span>
      {value.medianMs === null ? (
        <span className="text-sm theme-text-muted">—</span>
      ) : (
        <span className="text-sm font-medium theme-text-primary">
          {formatInsightDuration(value.medianMs, t)}
          <span className="ml-1 text-xs font-normal theme-text-muted">
            {t("listInsights.sampleSize", { count: String(value.sampleSize) })}
          </span>
        </span>
      )}
    </div>
  )
}

export function ListInsightsPanel({ listId }: { listId: string }) {
  const [days, setDays] = useState<InsightWindowDays>(DEFAULT_INSIGHT_WINDOW_DAYS)
  const [insights, setInsights] = useState<ListInsights | null>(null)
  // Which window failed, so choosing another one is a fresh attempt without a reset in the effect.
  const [failedDays, setFailedDays] = useState<InsightWindowDays | null>(null)

  useEffect(() => {
    let cancelled = false
    const query = new URLSearchParams({ days: String(days), tz: viewerTimeZone() })
    apiGet(`/api/v1/lists/${listId}/insights?${query}`)
      .then(response => response.json())
      .then((body: { insights: ListInsights }) => {
        if (!cancelled) setInsights(body.insights)
      })
      .catch(() => {
        if (!cancelled) setFailedDays(days)
      })
    return () => {
      cancelled = true
    }
  }, [listId, days])

  const showing = insights && insights.window.days === days ? insights : null
  return (
    <ListInsightsView
      insights={showing}
      failed={failedDays === days}
      days={days}
      onDaysChange={setDays}
    />
  )
}

interface ListInsightsViewProps {
  /** Null while loading. */
  insights: ListInsights | null
  failed: boolean
  days: InsightWindowDays
  onDaysChange: (days: InsightWindowDays) => void
}

/** The tab's content for a given answer — no fetching, so it renders the same in a test. */
export function ListInsightsView({ insights: showing, failed, days, onDaysChange: setDays }: ListInsightsViewProps) {
  const { t } = useTranslations()
  return (
    <div className="space-y-5" data-testid="list-insights">
      <div className="flex gap-1" role="group">
        {INSIGHT_WINDOW_DAYS.map(option => (
          <button
            key={option}
            type="button"
            onClick={() => setDays(option)}
            aria-pressed={days === option}
            className={`rounded-md px-2.5 py-1 text-xs ${
              days === option ? "theme-bg-secondary theme-text-primary font-medium" : "theme-text-muted"
            }`}
          >
            {t(`listInsights.days${option}`)}
          </button>
        ))}
      </div>

      {failed ? (
        <p className="text-sm theme-text-muted">{t("listInsights.loadFailed")}</p>
      ) : !showing ? (
        <p className="text-sm theme-text-muted">{t("listInsights.loading")}</p>
      ) : (
        <>
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold theme-text-primary">{t("listInsights.activity")}</h3>
              <span className="text-xs theme-text-muted">
                {t("listInsights.createdTotal", { count: String(showing.totals.created) })}
                {" · "}
                {t("listInsights.completedTotal", { count: String(showing.totals.completed) })}
              </span>
            </div>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={showing.series} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
                  <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} tick={{ fontSize: 10 }} minTickGap={16} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="linear" dataKey="created" name={t("listInsights.created")} stroke={CHART_SERIES_COLORS[0]} strokeWidth={2} dot={false} />
                  <Line type="linear" dataKey="completed" name={t("listInsights.completed")} stroke={CHART_SERIES_COLORS[1] ?? CHART_SERIES_COLORS[0]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section>
            <DurationStat label={t("listInsights.timeToComplete")} value={showing.createToComplete} t={t} />
          </section>

          {showing.lanes && (
            <section>
              <h3 className="mb-1 text-sm font-semibold theme-text-primary">{t("listInsights.timeInLane")}</h3>
              {showing.lanes.every(lane => lane.sampleSize === 0) ? (
                <p className="text-xs theme-text-muted">
                  {t("listInsights.notEnoughHistory")} {t("listInsights.laneHistoryNote")}
                </p>
              ) : (
                showing.lanes.map(lane => <DurationStat key={lane.role} label={lane.name} value={lane} t={t} />)
              )}
            </section>
          )}

          <section>
            <h3 className="mb-1 text-sm font-semibold theme-text-primary">{t("listInsights.contributors")}</h3>
            {showing.contributors.length === 0 ? (
              <p className="text-xs theme-text-muted">{t("listInsights.noActivity")}</p>
            ) : (
              <ul className="space-y-2">
                {showing.contributors.map(person => (
                  <li key={person.userId} className="flex items-start gap-2">
                    <ProfileImage src={person.image} alt={person.name ?? ""} fallback={getInitials(person.name)} size="xs" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="truncate text-sm theme-text-primary">{person.name ?? "—"}</span>
                        {person.isAIAgent && <Bot className="h-3 w-3 shrink-0 theme-text-muted" />}
                      </div>
                      {/* The profile's metrics, for this list (AWTD-1333), then activity. */}
                      <div className="text-xs theme-text-secondary">
                        {t("listInsights.profileCounts", {
                          completed: String(person.completed),
                          inspired: String(person.inspired),
                          supported: String(person.supported),
                        })}
                      </div>
                      <div className="text-xs theme-text-muted">
                        {t("listInsights.activityCounts", {
                          created: String(person.created),
                          edited: String(person.edited),
                          commented: String(person.commented),
                        })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
