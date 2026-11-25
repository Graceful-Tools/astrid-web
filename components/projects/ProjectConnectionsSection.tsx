"use client"

/**
 * The Connections section of project settings (ADEV-277): add, test and remove the project's
 * connectors to outside metric sources. Owner or admin only, and only where Goal Signals exists, so
 * it draws nothing when the connectors read is refused (404 capability off, 403 not granted or not
 * a manager). A connector never shows its credential, only that one is stored.
 */
import React from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiDelete, apiGet, apiPost } from "@/lib/api"
import { useTranslations } from "@/lib/i18n/client"
import type { ConnectorView } from "@/services/project-connectors.service"

const CUSTOM = "custom"

interface Offering {
  metricSources: Array<{ key: string; name: string }>
  customEndpoints: boolean
}

interface ProjectConnectionsSectionProps {
  projectId: string
}

export function ProjectConnectionsSection({ projectId }: ProjectConnectionsSectionProps) {
  const { t } = useTranslations()
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/connectors`
  const [connectors, setConnectors] = React.useState<ConnectorView[] | null>(null)
  const [offering, setOffering] = React.useState<Offering>({ metricSources: [], customEndpoints: false })
  const [serviceKey, setServiceKey] = React.useState("")
  const [name, setName] = React.useState("")
  const [endpointUrl, setEndpointUrl] = React.useState("")
  const [credential, setCredential] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [testResult, setTestResult] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [list, caps] = await Promise.all([apiGet(base), apiGet("/api/v1/capabilities")])
        const listBody = await list.json()
        const capsBody = await caps.json()
        if (!active) return
        const signals = capsBody?.goalSignals
        setOffering({
          metricSources: Array.isArray(signals?.metricSources) ? signals.metricSources : [],
          customEndpoints: signals?.customEndpoints === true,
        })
        setConnectors(Array.isArray(listBody?.connectors) ? listBody.connectors : [])
      } catch {
        // Refused or unavailable: the section simply is not there.
        if (active) setConnectors(null)
      }
    })()
    return () => {
      active = false
    }
  }, [base])

  if (connectors === null) return null
  const services = offering.metricSources
  if (!services.length && !offering.customEndpoints && !connectors.length) return null

  const custom = serviceKey === CUSTOM
  const canAdd = !!serviceKey && (!custom || !!endpointUrl.trim())

  const add = async () => {
    setError(null)
    try {
      const response = await apiPost(base, {
        kind: "metric",
        serviceKey,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(custom ? { endpointUrl: endpointUrl.trim(), ...(credential ? { credential } : {}) } : {}),
      })
      const created = (await response.json()) as ConnectorView
      setConnectors(current => [...(current ?? []), created])
      setName("")
      setEndpointUrl("")
      setCredential("")
    } catch {
      setError(t("projectMode.connections.saveFailed"))
    }
  }

  const remove = async (id: string) => {
    setError(null)
    try {
      await apiDelete(`${base}/${encodeURIComponent(id)}`)
      setConnectors(current => (current ?? []).filter(c => c.id !== id))
    } catch {
      setError(t("projectMode.connections.saveFailed"))
    }
  }

  const test = async (id: string) => {
    setError(null)
    try {
      const response = await apiPost(`${base}/${encodeURIComponent(id)}/test`, {})
      const body = await response.json()
      setTestResult(current => ({ ...current, [id]: body?.ok === true }))
      if (body?.connector) setConnectors(current => (current ?? []).map(c => (c.id === id ? body.connector : c)))
    } catch {
      setError(t("projectMode.connections.saveFailed"))
    }
  }

  return (
    <div className="space-y-3 text-sm theme-text-primary" data-testid="project-connections">
      <h3 className="text-sm font-semibold">{t("projectMode.connections.title")}</h3>
      <p className="text-xs theme-text-secondary">{t("projectMode.connections.intro")}</p>

      {connectors.length === 0 ? (
        <p className="text-xs theme-text-secondary">{t("projectMode.connections.none")}</p>
      ) : (
        <ul className="space-y-1">
          {connectors.map(connector => (
            <li key={connector.id} className="flex items-center gap-2 rounded-md border theme-border p-2" data-testid="project-connector-row">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{connector.name}</div>
                <div className="truncate text-xs theme-text-secondary">
                  {connector.state === "ok" ? t("projectMode.connections.stateOk") : t("projectMode.connections.stateError")}
                  {connector.lastError ? ` · ${connector.lastError}` : ""}
                  {connector.hasCredential ? ` · ${t("projectMode.connections.credentialStored")}` : ""}
                </div>
                {testResult[connector.id] !== undefined && (
                  <div role="status" className="text-xs">
                    {testResult[connector.id] ? t("projectMode.connections.testOk") : t("projectMode.connections.testFailed")}
                  </div>
                )}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => test(connector.id)}>
                {t("projectMode.connections.test")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("projectMode.connections.remove")}
                title={t("projectMode.connections.remove")}
                onClick={() => remove(connector.id)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {(services.length > 0 || offering.customEndpoints) && (
        <div className="space-y-2 rounded-md border theme-border p-2">
          <Select value={serviceKey} onValueChange={setServiceKey}>
            <SelectTrigger aria-label={t("projectMode.connections.serviceLabel")}>
              <SelectValue placeholder={t("projectMode.connections.serviceLabel")} />
            </SelectTrigger>
            <SelectContent>
              {services.map(service => (
                <SelectItem key={service.key} value={service.key}>{service.name}</SelectItem>
              ))}
              {offering.customEndpoints && <SelectItem value={CUSTOM}>{t("projectMode.connections.customOption")}</SelectItem>}
            </SelectContent>
          </Select>
          <Input
            value={name}
            maxLength={80}
            placeholder={t("projectMode.connections.nameLabel")}
            aria-label={t("projectMode.connections.nameLabel")}
            onChange={event => setName(event.target.value)}
          />
          {custom && (
            <>
              <Input
                value={endpointUrl}
                placeholder={t("projectMode.connections.endpointLabel")}
                aria-label={t("projectMode.connections.endpointLabel")}
                onChange={event => setEndpointUrl(event.target.value)}
              />
              <Input
                type="password"
                autoComplete="off"
                value={credential}
                placeholder={t("projectMode.connections.credentialLabel")}
                aria-label={t("projectMode.connections.credentialLabel")}
                onChange={event => setCredential(event.target.value)}
              />
            </>
          )}
          <Button type="button" size="sm" disabled={!canAdd} onClick={add}>
            {t("projectMode.connections.add")}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}
