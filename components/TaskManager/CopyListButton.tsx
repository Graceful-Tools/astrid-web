"use client"

import { Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n/client"

/** The full-width "Copy List" action a visitor gets on a featured or copy-only public list. */
export function CopyListButton({ onCopy }: { onCopy: () => void }) {
  const { t } = useTranslations()
  return (
    <Button onClick={onCopy} className="w-full bg-brand hover:bg-brand-hover text-brand-foreground">
      <Copy className="w-4 h-4 mr-2" />
      {t('lists.copyList')}
    </Button>
  )
}
