"use client"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Check, Copy } from "lucide-react"

/**
 * One labelled, copyable credential value. Shared by every "shown once"
 * dialog — Custom Agent registration and the agents page's inline client
 * credentials — so a secret is presented the same way wherever it appears.
 */
export function CredentialField({
  label,
  value,
  field,
  copiedField,
  onCopy,
  sensitive,
}: {
  label: string
  value: string
  field: string
  copiedField: string | null
  onCopy: (text: string, field: string) => void
  sensitive?: boolean
}) {
  return (
    <div>
      <Label className="text-xs theme-text-muted">{label}</Label>
      <div className="flex items-center gap-2 mt-0.5">
        <code
          className={`flex-1 text-xs font-mono p-2 theme-bg-tertiary rounded truncate ${
            sensitive ? "text-red-400" : "theme-text-primary"
          }`}
        >
          {value}
        </code>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => onCopy(value, field)}
        >
          {copiedField === field ? (
            <Check className="w-4 h-4 text-green-500" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  )
}

/** Clipboard write with the execCommand fallback older WebViews still need. */
export async function copyCredential(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const el = document.createElement("textarea")
    el.value = text
    document.body.appendChild(el)
    el.select()
    document.execCommand("copy")
    document.body.removeChild(el)
  }
}
