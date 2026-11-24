"use client"

import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { renderMarkdownWithLinks } from '@/lib/markdown'
import { decisionReply, ratingLabels, type DecisionOption, type ParsedDecision } from '@/lib/comment-formats'
import { parseGrid } from '@/lib/decision-grid'
import { useTranslations } from '@/lib/i18n/client'
import { useTradeoffGridViewer } from '@/components/shared/TradeoffGridViewer'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { IdentifierLinkContext } from '@/lib/task-identifier-links'

interface DecisionCardsProps {
  decision: ParsedDecision
  /** Number of the option someone already picked; marks that card chosen. */
  chosen: number | null
  /** Cards are inert unless this is set (in a thread, not yet answered). */
  onChoose?: (reply: string) => void
  identifiers?: IdentifierLinkContext
}

const prose = 'prose prose-sm max-w-none text-sm theme-text-secondary'

/**
 * Whether the decision draws as its grid alone (ADEV-230, as iOS ADEV-229): a trade-off grid after
 * the options with exactly one row per option. Row n is option n; the grid numbers rows in order.
 */
export function gridIsTheChoice(decision: ParsedDecision): boolean {
  const found = parseGrid(decision.after)
  return !!found && found.grid.options.length === decision.options.length
}

/**
 * A Decision comment (AWTD-1524), format in PRODUCT_CONTRACT.md §8: one card per option, or, when a
 * grid with one row per option follows, the grid alone with its rows as the choice (ADEV-230).
 */
export function DecisionCards({ decision, chosen, onChoose, identifiers }: DecisionCardsProps) {
  const { t } = useTranslations()
  const labels = ratingLabels(t)
  const md = (text: string) => ({ __html: renderMarkdownWithLinks(text, { identifiers, ratingLabels: labels }) })
  const gridViewer = useTradeoffGridViewer()
  const asGrid = useMemo(() => gridIsTheChoice(decision), [decision])
  const interactive = !!onChoose && chosen === null

  if (asGrid) {
    return (
      <DecisionGrid
        decision={decision}
        chosen={chosen}
        onChoose={interactive ? onChoose : undefined}
        gridHtml={md(decision.after)}
        beforeHtml={decision.before ? md(decision.before) : null}
        promptHtml={md(`**${decision.prompt}**`)}
        gridViewer={gridViewer}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2" data-testid="decision-cards" onClick={gridViewer.onClick} onKeyDown={gridViewer.onKeyDown}>
      {gridViewer.dialog}
      {decision.before && <div className={prose} dangerouslySetInnerHTML={md(decision.before)} />}
      <div className={prose} dangerouslySetInnerHTML={md(`**${decision.prompt}**`)} />
      <div className="flex flex-col gap-1.5">
        {decision.options.map(option => {
          const isChosen = chosen === option.number
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
              className={`decision-card flex items-start gap-2 border-1 px-3 py-2 text-left text-sm ${
                isChosen ? 'border-brand ring-1 ring-brand' : 'border-theme'
              } ${interactive ? 'hover:border-brand cursor-pointer' : 'cursor-default'}`}
            >
              {/* Numbered in order, whatever marker the asker wrote (AWTD-1533). */}
              <span className="decision-badge">{option.number}</span>
              <span className="flex-1 leading-6" dangerouslySetInnerHTML={md(option.text)} />
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

interface DecisionGridProps {
  decision: ParsedDecision
  chosen: number | null
  /** Set only while the question is open to this viewer. */
  onChoose?: (reply: string) => void
  gridHtml: { __html: string }
  beforeHtml: { __html: string } | null
  promptHtml: { __html: string }
  gridViewer: ReturnType<typeof useTradeoffGridViewer>
}

/**
 * The question and its grid, with the grid's rows as the options (ADEV-230). The grid arrives as
 * sanitised HTML, so its rows are marked after render and taps are read by delegation. A tap asks
 * first, because a sideways scroll of a wide grid can land one by accident.
 */
function DecisionGrid({ decision, chosen, onChoose, gridHtml, beforeHtml, promptHtml, gridViewer }: DecisionGridProps) {
  const { t } = useTranslations()
  const gridRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<DecisionOption | null>(null)

  // The decision's grid is the first one after the options: the one parseGrid matched.
  const rowsOf = (): HTMLElement[] => {
    const body = gridRef.current?.querySelector('.tradeoff tbody')
    return body ? Array.from(body.children).filter((r): r is HTMLElement => r instanceof HTMLElement) : []
  }

  useLayoutEffect(() => {
    rowsOf().forEach((row, i) => {
      const option = decision.options[i]
      const mark = (name: string, on: boolean) => {
        if (on) row.dataset[name] = 'true'
        else delete row.dataset[name]
      }
      mark('recommended', !!option?.recommended)
      mark('chosen', chosen !== null && option?.number === chosen)
      mark('dimmed', chosen !== null && option?.number !== chosen)
      mark('choosable', !!onChoose)
      if (onChoose && option) {
        row.tabIndex = 0
        row.setAttribute('aria-label', decisionReply(option))
      } else {
        row.removeAttribute('tabindex')
        row.removeAttribute('aria-label')
      }
    })
    // gridHtml is a fresh object each render; its string is what changes the rows.
  }, [gridHtml.__html, chosen, onChoose, decision])

  const optionAt = (target: EventTarget | null): DecisionOption | null => {
    if (!onChoose || !(target instanceof Element)) return null
    // A link in a cell opens the link (AWTD-1531).
    if (target.closest('a')) return null
    const row = target.closest('tr')
    if (!(row instanceof HTMLElement)) return null
    const index = rowsOf().indexOf(row)
    return index >= 0 ? decision.options[index] ?? null : null
  }

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    gridViewer.onClick(e)
    if (e.defaultPrevented) return
    const option = optionAt(e.target)
    if (option) {
      e.stopPropagation()
      setPending(option)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    gridViewer.onKeyDown(e)
    if (e.defaultPrevented || (e.key !== 'Enter' && e.key !== ' ')) return
    const option = optionAt(e.target)
    if (option) {
      e.preventDefault()
      e.stopPropagation()
      setPending(option)
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="decision-grid">
      {gridViewer.dialog}
      {beforeHtml && <div className={prose} dangerouslySetInnerHTML={beforeHtml} />}
      <div className={prose} dangerouslySetInnerHTML={promptHtml} />
      {onChoose && <p className="text-xs theme-text-muted">{t('tasks.decision.tapRowHint')}</p>}
      <div
        ref={gridRef}
        className={`${prose} decision-grid-choice`}
        data-choosable={onChoose ? true : undefined}
        onClick={onClick}
        onKeyDown={onKeyDown}
        dangerouslySetInnerHTML={gridHtml}
      />
      <ConfirmDialog
        open={pending !== null}
        title={t('tasks.decision.confirmTitle')}
        detail={pending ? decisionReply(pending) : ''}
        confirmLabel={pending ? t('tasks.decision.chooseOption', { option: decisionReply(pending) }) : ''}
        destructive={false}
        testId="decision-grid-confirm"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const option = pending
          setPending(null)
          if (option) onChoose?.(decisionReply(option))
        }}
      />
    </div>
  )
}
