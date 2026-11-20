"use client"

import { useEffect, useState } from "react"
import { Bot } from "lucide-react"
import { Avatar, AvatarImage } from "@/components/ui/avatar"
import { Label } from "@/components/ui/label"
import { apiGet } from "@/lib/api"
import { useTranslations } from "@/lib/i18n/client"
import { formatRelativeFromNow } from "@/lib/i18n/date-format"
import { cn } from "@/lib/utils"
import type { ListAgentRoster as Roster } from "@/services/agent-presence.service"

/**
 * Which agents are alive on this board (AWTD-1697): per agent, when it was last
 * seen, the task it holds, and a plain "not seen since" once it has missed its
 * expected interval. Also flags Ready work that has waited past the pickup time.
 */
export function ListAgentRoster({ listId }: { listId: string }) {
  const { t, locale } = useTranslations()
  const [roster, setRoster] = useState<Roster | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet(`/api/v1/lists/${listId}/agents`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled && data?.roster) setRoster(data.roster) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [listId])

  if (!roster) return null
  const ago = (iso: string) => formatRelativeFromNow(new Date(iso).getTime() - Date.now(), locale)

  return (
    <div className="space-y-2" data-testid="agent-roster">
      <Label className="text-sm theme-text-primary">{t("listSettings.agentRoster.title")}</Label>
      {roster.agents.length === 0 ? (
        <p className="text-xs theme-text-muted">{t("listSettings.agentRoster.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {roster.agents.map(entry => (
            <li key={entry.agent.id} className="flex items-start gap-2 text-sm" data-testid="agent-roster-row">
              {entry.agent.image ? (
                <Avatar className="w-4 h-4 mt-0.5"><AvatarImage src={entry.agent.image} alt="" /></Avatar>
              ) : (
                <Bot className="w-4 h-4 mt-0.5 text-agent" />
              )}
              <div className="min-w-0">
                <div className="theme-text-primary">{entry.agent.name || entry.agent.email}</div>
                <div className={cn("text-xs", entry.state === "quiet" ? "text-danger" : "theme-text-muted")}>
                  {entry.lastSeenAt
                    ? t(entry.state === "quiet" ? "listSettings.agentRoster.notSeen" : "listSettings.agentRoster.lastSeen", { when: ago(entry.lastSeenAt) })
                    : t("listSettings.agentRoster.neverSeen")}
                </div>
                <div className="text-xs theme-text-muted truncate">
                  {entry.heldTask
                    ? t("listSettings.agentRoster.holds", {
                        task: `${entry.heldTask.identifier ? `${entry.heldTask.identifier} · ` : ""}${entry.heldTask.title}`,
                      })
                    : t("listSettings.agentRoster.idle")}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {roster.readyWait && (
        <p className="text-xs text-warning" data-testid="agent-roster-ready-wait">
          {t("listSettings.agentRoster.readyWait", { count: String(roster.readyWait.count), when: ago(roster.readyWait.oldestSince) })}
          {roster.readyWait.reason === "no_agent_enrolled" && ` ${t("listSettings.agentRoster.reasonNoAgent")}`}
          {roster.readyWait.reason === "agent_not_seen" && ` ${t("listSettings.agentRoster.reasonNotSeen")}`}
        </p>
      )}
    </div>
  )
}
