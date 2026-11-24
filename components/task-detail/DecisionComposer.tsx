"use client"

import { useMemo, useState } from 'react'
import { Plus, Star, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { DecisionCards } from '@/components/task-detail/DecisionCards'
import { useTranslations } from '@/lib/i18n/client'
import { parseDecision, RATING_STYLE, ratingLabels, type Rating } from '@/lib/comment-formats'
import {
  DRAFT_RATINGS,
  MAX_DRAFT_CRITERIA,
  decisionDraftMarkdown,
  decisionDraftProblem,
  draftCell,
  draftId,
  emptyDecisionDraft,
  setDraftCell,
  type DecisionDraft,
} from '@/lib/decision-draft'

export type DecisionDestination = 'comment' | 'description'

interface DecisionComposerProps {
  open: boolean
  onClose: () => void
  /** Whether "In description" is offered: only to someone who may edit the task. */
  canEditDescription: boolean
  /** Posts the finished markdown. Resolves once it is sent, so the composer can close. */
  onPost: (markdown: string, destination: DecisionDestination) => void | Promise<void>
}

/**
 * "Ask for a decision" from task details (ADEV-240; iOS DecisionComposerView, ADEV-189/231): a
 * question, at least two options (one may be starred as recommended), and optionally criteria
 * rated per option in five traffic lights with a note. It writes the docs/DECISIONS.md markdown,
 * previewed with the same renderer the thread uses.
 */
export function DecisionComposer({ open, onClose, canEditDescription, onPost }: DecisionComposerProps) {
  const { t } = useTranslations()
  const [draft, setDraft] = useState<DecisionDraft>(() => emptyDecisionDraft())
  const [destination, setDestination] = useState<DecisionDestination>('comment')
  const [posting, setPosting] = useState(false)
  const labels = ratingLabels(t)

  const markdown = useMemo(() => decisionDraftMarkdown(draft), [draft])
  const problem = decisionDraftProblem(draft)
  const preview = useMemo(() => (problem === 'noQuestion' || problem === 'tooFewOptions' ? null : parseDecision(markdown)), [markdown, problem])

  const reset = () => {
    setDraft(emptyDecisionDraft())
    setDestination('comment')
  }
  const close = () => {
    reset()
    onClose()
  }

  const post = async () => {
    if (problem || posting) return
    setPosting(true)
    try {
      await onPost(markdown, canEditDescription ? destination : 'comment')
      close()
    } finally {
      setPosting(false)
    }
  }

  const problemText =
    problem === 'tooFewOptions' ? t('tasks.decisionComposer.needsTwoOptions')
      : problem === 'reasonWithoutRating' ? t('tasks.decisionComposer.reasonNeedsColour')
        : null

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) close() }}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto theme-panel" aria-describedby={undefined} data-testid="decision-composer">
        <DialogTitle>{t('tasks.decisionComposer.title')}</DialogTitle>

        <section className="flex flex-col gap-2">
          <label className="text-sm font-medium theme-text-primary" htmlFor="decision-question">{t('tasks.decisionComposer.question')}</label>
          <Input
            id="decision-question"
            value={draft.question}
            placeholder={t('tasks.decisionComposer.questionPlaceholder')}
            onChange={e => setDraft(d => ({ ...d, question: e.target.value }))}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium theme-text-primary">{t('tasks.decisionComposer.options')}</h3>
          {draft.options.map((option, i) => (
            <div key={option.id} className="flex items-center gap-2">
              <span className="decision-badge">{i + 1}</span>
              <Input
                value={option.text}
                aria-label={`${t('tasks.decisionComposer.optionPlaceholder')} ${i + 1}`}
                placeholder={t('tasks.decisionComposer.optionPlaceholder')}
                onChange={e => setDraft(d => ({ ...d, options: d.options.map(o => (o.id === option.id ? { ...o, text: e.target.value } : o)) }))}
              />
              <button
                type="button"
                aria-pressed={draft.recommended === option.id}
                aria-label={t('tasks.decisionComposer.recommendHint')}
                title={t('tasks.decisionComposer.recommendHint')}
                className={`h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-full ${draft.recommended === option.id ? 'text-brand' : 'theme-text-muted'}`}
                onClick={() => setDraft(d => ({ ...d, recommended: d.recommended === option.id ? null : option.id }))}
              >
                <Star className="w-4 h-4" fill={draft.recommended === option.id ? 'currentColor' : 'none'} />
              </button>
              {draft.options.length > 2 && (
                <button
                  type="button"
                  aria-label={t('actions.delete')}
                  className="h-9 w-9 flex-shrink-0 flex items-center justify-center theme-text-muted"
                  onClick={() => setDraft(d => ({ ...d, options: d.options.filter(o => o.id !== option.id), recommended: d.recommended === option.id ? null : d.recommended }))}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="self-start flex items-center gap-1 text-sm text-brand"
            onClick={() => setDraft(d => ({ ...d, options: [...d.options, { id: draftId('o'), text: '' }] }))}
          >
            <Plus className="w-4 h-4" /> {t('tasks.decisionComposer.addOption')}
          </button>
          <p className="text-xs theme-text-muted">{t('tasks.decisionComposer.recommendHint')}</p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium theme-text-primary">{t('tasks.decisionComposer.criteria')}</h3>
          <p className="text-xs theme-text-muted">{t('tasks.decisionComposer.criteriaHint')}</p>
          {draft.criteria.map((criterion, ci) => (
            <div key={criterion.id} className="flex flex-col gap-2 border-1 border-theme rounded-md p-2" data-testid="decision-criterion">
              <div className="flex items-center gap-2">
                <span className="tradeoff-col">{String.fromCharCode(65 + ci)}</span>
                <Input
                  value={criterion.name}
                  placeholder={t('tasks.decisionComposer.criterionPlaceholder')}
                  aria-label={t('tasks.decisionComposer.criterionPlaceholder')}
                  onChange={e => setDraft(d => ({ ...d, criteria: d.criteria.map(c => (c.id === criterion.id ? { ...c, name: e.target.value } : c)) }))}
                />
                <button
                  type="button"
                  aria-label={t('actions.delete')}
                  className="h-9 w-9 flex-shrink-0 flex items-center justify-center theme-text-muted"
                  onClick={() => setDraft(d => ({ ...d, criteria: d.criteria.filter(c => c.id !== criterion.id) }))}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <Input
                value={criterion.detail}
                placeholder={t('tasks.decisionComposer.criterionDetailPlaceholder')}
                aria-label={t('tasks.decisionComposer.criterionDetailPlaceholder')}
                onChange={e => setDraft(d => ({ ...d, criteria: d.criteria.map(c => (c.id === criterion.id ? { ...c, detail: e.target.value } : c)) }))}
              />
              {draft.options.map((option, oi) => {
                const cell = draftCell(draft, option.id, criterion.id)
                const setCell = (next: { rating: Rating | null; text: string }) => setDraft(d => setDraftCell(d, option.id, criterion.id, next))
                return (
                  <div key={option.id} className="flex flex-wrap items-center gap-2 pl-6">
                    <span className="text-xs theme-text-secondary w-24 truncate">{oi + 1}. {option.text || t('tasks.decisionComposer.optionPlaceholder')}</span>
                    <div className="flex gap-1" role="group" aria-label={`${criterion.name || String.fromCharCode(65 + ci)} · ${oi + 1}`}>
                      {DRAFT_RATINGS.map(rating => {
                        const style = RATING_STYLE[rating]
                        const on = cell.rating === rating
                        return (
                          <button
                            key={rating}
                            type="button"
                            aria-pressed={on}
                            title={labels[style.labelKey] || style.label}
                            aria-label={labels[style.labelKey] || style.label}
                            className={`h-7 w-8 rounded text-xs font-semibold ${style.className} ${on ? 'ring-2 ring-offset-1 ring-brand' : 'opacity-60'}`}
                            // Tapping the chosen light again clears it, as on iOS.
                            onClick={() => setCell({ rating: on ? null : rating, text: cell.text })}
                          >
                            {rating}
                          </button>
                        )
                      })}
                    </div>
                    <Input
                      className="flex-1 min-w-40 h-8"
                      value={cell.text}
                      placeholder={t('tasks.decisionComposer.reasonPlaceholder')}
                      aria-label={t('tasks.decisionComposer.reasonPlaceholder')}
                      onChange={e => setCell({ rating: cell.rating, text: e.target.value })}
                    />
                  </div>
                )
              })}
            </div>
          ))}
          {draft.criteria.length < MAX_DRAFT_CRITERIA && (
            <button
              type="button"
              className="self-start flex items-center gap-1 text-sm text-brand"
              onClick={() => setDraft(d => ({ ...d, criteria: [...d.criteria, { id: draftId('c'), name: '', detail: '' }] }))}
            >
              <Plus className="w-4 h-4" /> {t('tasks.decisionComposer.addCriterion')}
            </button>
          )}
        </section>

        {canEditDescription && (
          <section className="flex flex-col gap-1">
            <h3 className="text-sm font-medium theme-text-primary">{t('tasks.decisionComposer.postTo')}</h3>
            <div className="flex gap-2" role="radiogroup">
              {(['comment', 'description'] as const).map(d => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={destination === d}
                  className={`px-3 py-1 rounded-full text-sm border-1 ${destination === d ? 'border-brand text-brand' : 'border-theme theme-text-secondary'}`}
                  onClick={() => setDestination(d)}
                >
                  {t(d === 'comment' ? 'tasks.decisionComposer.asComment' : 'tasks.decisionComposer.inDescription')}
                </button>
              ))}
            </div>
            <p className="text-xs theme-text-muted">
              {t(destination === 'comment' ? 'tasks.decisionComposer.commentHint' : 'tasks.decisionComposer.descriptionHint')}
            </p>
          </section>
        )}

        {preview && (
          <section className="flex flex-col gap-1" data-testid="decision-composer-preview">
            <h3 className="text-sm font-medium theme-text-primary">{t('tasks.decisionComposer.preview')}</h3>
            <div className="border-1 border-theme rounded-md p-2">
              <DecisionCards decision={preview} chosen={null} />
            </div>
          </section>
        )}

        {problemText && <p className="text-xs text-danger" role="alert">{problemText}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="px-3 py-1.5 text-sm theme-text-secondary" onClick={close}>{t('actions.cancel')}</button>
          <button
            type="button"
            disabled={!!problem || posting}
            className="px-3 py-1.5 text-sm rounded-md bg-brand text-white disabled:opacity-50"
            onClick={post}
            data-testid="decision-composer-post"
          >
            {t(canEditDescription && destination === 'description' ? 'tasks.decisionComposer.add' : 'tasks.decisionComposer.post')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
