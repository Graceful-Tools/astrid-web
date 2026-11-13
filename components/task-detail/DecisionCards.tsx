"use client"

import { renderMarkdownWithLinks } from '@/lib/markdown'
import { decisionReply, ratingLabels, type ParsedDecision } from '@/lib/comment-formats'
import { useTranslations } from '@/lib/i18n/client'
import { useTradeoffGridViewer } from '@/components/shared/TradeoffGridViewer'
import type { IdentifierLinkContext } from '@/lib/task-identifier-links'

interface DecisionCardsProps {
  decision: ParsedDecision
  /** Number of the option someone already picked; marks that card chosen. */
  chosen: number | null
  /** Cards are inert unless this is set (not your own question, not yet answered). */
  onChoose?: (reply: string) => void
  identifiers?: IdentifierLinkContext
}

const prose = 'prose prose-sm max-w-none text-sm theme-text-secondary'

/** A Decision comment drawn as one card per option (AWTD-1524). Format: PRODUCT_CONTRACT.md §8. */
export function DecisionCards({ decision, chosen, onChoose, identifiers }: DecisionCardsProps) {
  const { t } = useTranslations()
  const labels = ratingLabels(t)
  const md = (text: string) => ({ __html: renderMarkdownWithLinks(text, { identifiers, ratingLabels: labels }) })
  const gridViewer = useTradeoffGridViewer()
  return (
    <div className="flex flex-col gap-2" data-testid="decision-cards" onClick={gridViewer.onClick} onKeyDown={gridViewer.onKeyDown}>
      {gridViewer.dialog}
      {decision.before && <div className={prose} dangerouslySetInnerHTML={md(decision.before)} />}
      <div className={prose} dangerouslySetInnerHTML={md(`**${decision.prompt}**`)} />
      <div className="flex flex-col gap-1.5">
        {decision.options.map(option => {
          const isChosen = chosen === option.number
          const interactive = !!onChoose && chosen === null
          return (
            <button
              key={option.number}
              type="button"
              disabled={!interactive}
              data-chosen={isChosen || undefined}
              onClick={e => {
                e.stopPropagation()
                // A link in the option opens the link; only the card itself answers (AWTD-1531).
                if ((e.target as HTMLElement).closest('a')) return
                onChoose?.(decisionReply(option))
              }}
              className={`flex items-start gap-2 rounded-lg border-1 px-3 py-2 text-left text-sm ${
                isChosen ? 'border-brand ring-1 ring-brand' : 'border-theme'
              } ${interactive ? 'hover:border-brand cursor-pointer' : 'cursor-default'}`}
            >
              {/* Numbered in order, whatever marker the asker wrote (AWTD-1533). */}
              <span className="font-semibold">{option.number}</span>
              <span className="flex-1" dangerouslySetInnerHTML={md(option.text)} />
              {option.recommended && (
                <span className="rounded bg-success-subtle px-1.5 text-xs text-success">
                  ★
                </span>
              )}
            </button>
          )
        })}
      </div>
      {decision.after && <div className={prose} dangerouslySetInnerHTML={md(decision.after)} />}
    </div>
  )
}
