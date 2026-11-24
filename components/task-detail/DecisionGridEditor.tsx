"use client"

/**
 * The grid editor for a decision task's description (ADEV-188, the UI half of ADEV-180). It edits
 * the trade-off grid's criteria, options and cells, each cell a traffic-light rating plus a short
 * reason, and writes the grid back in place (lib/decision-grid.ts `applyDecisionEdit`), so the
 * prose around it stays as written. There is no score or total column: the person decides.
 * When the Decision's options are the grid's rows, an option edited here is edited in the question.
 */
import { useEffect, useState } from 'react'
import { Plus, Star, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useTranslations } from '@/lib/i18n/client'
import { columnLetter, RATING_STYLE, ratingLabels, type Rating } from '@/lib/comment-formats'
import { DRAFT_RATINGS, MAX_DRAFT_CRITERIA } from '@/lib/decision-draft'
import {
  applyDecisionEdit,
  editableDecision,
  gridEditProblem,
  type DecisionGrid,
  type EditableDecision,
  type GridCell,
  type GridEditProblem,
} from '@/lib/decision-grid'

interface DecisionGridEditorProps {
  open: boolean
  description: string
  onClose: () => void
  /** Saves the whole new description; the editor closes once it resolves. */
  onSave: (description: string) => void | Promise<void>
}

const EMPTY_CELL: GridCell = { rating: null, text: '' }
const ADD_BUTTON = 'self-start flex items-center gap-1 text-sm text-brand'

const PROBLEM_KEY: Record<GridEditProblem, string> = {
  tooFewOptions: 'tasks.decisionGridEditor.tooFewOptions',
  noCriteria: 'tasks.decisionGridEditor.noCriteria',
  unnamed: 'tasks.decisionGridEditor.unnamed',
  reasonWithoutRating: 'tasks.decisionComposer.reasonNeedsColour',
  noRating: 'tasks.decisionGridEditor.noRating',
}

export function DecisionGridEditor({ open, description, onClose, onSave }: DecisionGridEditorProps) {
  const { t } = useTranslations()
  const labels = ratingLabels(t)
  const [state, setState] = useState<EditableDecision | null>(() => editableDecision(description))
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  // Start from the description each time the editor opens.
  useEffect(() => {
    if (open) {
      setState(editableDecision(description))
      setSaveFailed(false)
    }
  }, [open, description])

  if (!state) return null
  const { grid, recommended, optionsAreRows } = state
  const problem = gridEditProblem(grid)

  const setGrid = (update: (g: DecisionGrid) => DecisionGrid) => setState(s => (s ? { ...s, grid: update(s.grid) } : s))
  const setCell = (row: number, col: number, cell: GridCell) =>
    setGrid(g => ({
      ...g,
      options: g.options.map((o, r) =>
        r === row ? { ...o, cells: g.criteria.map((_, c) => (c === col ? cell : o.cells[c] ?? EMPTY_CELL)) } : o,
      ),
    }))

  const addCriterion = () =>
    setGrid(g => ({ ...g, criteria: [...g.criteria, ''], options: g.options.map(o => ({ ...o, cells: [...g.criteria.map((_, c) => o.cells[c] ?? EMPTY_CELL), EMPTY_CELL] })) }))
  const removeCriterion = (col: number) =>
    setGrid(g => ({ ...g, criteria: g.criteria.filter((_, c) => c !== col), options: g.options.map(o => ({ ...o, cells: o.cells.filter((_, c) => c !== col) })) }))
  const addOption = () =>
    setGrid(g => ({ ...g, options: [...g.options, { name: '', cells: g.criteria.map(() => EMPTY_CELL) }] }))
  const removeOption = (row: number) =>
    setState(s => {
      if (!s) return s
      const star = s.recommended === null || s.recommended === row ? null : s.recommended > row ? s.recommended - 1 : s.recommended
      return { ...s, recommended: star, grid: { ...s.grid, options: s.grid.options.filter((_, r) => r !== row) } }
    })

  const save = async () => {
    if (problem || saving) return
    const next = applyDecisionEdit(description, grid, recommended)
    if (next === null) return
    setSaving(true)
    setSaveFailed(false)
    try {
      await onSave(next)
      onClose()
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl flex flex-col gap-4" data-testid="decision-grid-editor">
        <DialogTitle>{t('tasks.decisionGridEditor.title')}</DialogTitle>
        <DialogDescription>{t('tasks.decisionComposer.criteriaHint')}</DialogDescription>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium theme-text-primary">{t('tasks.decisionGridEditor.criteria')}</h3>
          {grid.criteria.map((name, col) => (
            <div key={col} className="flex items-center gap-2">
              <span className="w-5 text-xs font-semibold theme-text-secondary">{columnLetter(col)}</span>
              <Input
                value={name}
                placeholder={t('tasks.decisionComposer.criterionPlaceholder')}
                aria-label={t('tasks.decisionComposer.criterionPlaceholder')}
                data-testid={`grid-editor-criterion-${col}`}
                onChange={e => setGrid(g => ({ ...g, criteria: g.criteria.map((c, i) => (i === col ? e.target.value : c)) }))}
              />
              {grid.criteria.length > 1 && (
                <button
                  type="button"
                  className="theme-text-muted"
                  aria-label={t('tasks.decisionGridEditor.remove')}
                  title={t('tasks.decisionGridEditor.remove')}
                  onClick={() => removeCriterion(col)}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {grid.criteria.length < MAX_DRAFT_CRITERIA && (
            <button
              type="button"
              className={ADD_BUTTON}
              data-testid="grid-editor-add-criterion"
              onClick={addCriterion}
            >
              <Plus className="w-4 h-4" /> {t('tasks.decisionComposer.addCriterion')}
            </button>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium theme-text-primary">{t('tasks.decisionGridEditor.options')}</h3>
          {optionsAreRows && <p className="text-xs theme-text-muted">{t('tasks.decisionGridEditor.optionsAreRowsHint')}</p>}
          {grid.options.map((option, row) => (
            <div key={row} className="flex flex-col gap-2 rounded-md border-1 border-theme p-2">
              <div className="flex items-center gap-2">
                <span className="w-5 text-xs font-semibold theme-text-secondary">{row + 1}</span>
                {optionsAreRows && (
                  <button
                    type="button"
                    aria-pressed={recommended === row}
                    aria-label={t('tasks.decisionGridEditor.recommend')}
                    title={t('tasks.decisionGridEditor.recommend')}
                    className={recommended === row ? 'text-brand' : 'theme-text-muted'}
                    onClick={() => setState(s => (s ? { ...s, recommended: s.recommended === row ? null : row } : s))}
                  >
                    <Star className="w-4 h-4" fill={recommended === row ? 'currentColor' : 'none'} />
                  </button>
                )}
                <Input
                  value={option.name}
                  placeholder={t('tasks.decisionComposer.optionPlaceholder')}
                  aria-label={t('tasks.decisionComposer.optionPlaceholder')}
                  onChange={e => setGrid(g => ({ ...g, options: g.options.map((o, r) => (r === row ? { ...o, name: e.target.value } : o)) }))}
                />
                {grid.options.length > 2 && (
                  <button
                    type="button"
                    className="theme-text-muted"
                    aria-label={t('tasks.decisionGridEditor.remove')}
                    title={t('tasks.decisionGridEditor.remove')}
                    onClick={() => removeOption(row)}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {grid.criteria.map((criterion, col) => {
                const cell = option.cells[col] ?? EMPTY_CELL
                return (
                  <div key={col} className="flex flex-wrap items-center gap-2 pl-7">
                    <span className="text-xs theme-text-secondary w-24 truncate">{columnLetter(col)} {criterion}</span>
                    <div className="flex gap-1" role="group" aria-label={`${criterion || columnLetter(col)} · ${row + 1}`}>
                      {DRAFT_RATINGS.map((rating: Rating) => {
                        const style = RATING_STYLE[rating]
                        const on = cell.rating === rating
                        return (
                          <button
                            key={rating}
                            type="button"
                            aria-pressed={on}
                            title={labels[style.labelKey] || style.label}
                            aria-label={labels[style.labelKey] || style.label}
                            data-testid={`grid-editor-rating-${row}-${col}-${rating}`}
                            className={`h-7 w-8 rounded text-xs font-semibold ${style.className} ${on ? 'ring-2 ring-offset-1 ring-brand' : 'opacity-60'}`}
                            // Tapping the chosen light again clears it, as in the composer.
                            onClick={() => setCell(row, col, { rating: on ? null : rating, text: cell.text })}
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
                      onChange={e => setCell(row, col, { rating: cell.rating, text: e.target.value })}
                    />
                  </div>
                )
              })}
            </div>
          ))}
          <button type="button" className={ADD_BUTTON} onClick={addOption}>
            <Plus className="w-4 h-4" /> {t('tasks.decisionComposer.addOption')}
          </button>
        </section>

        {problem && <p className="text-xs text-danger" role="alert">{t(PROBLEM_KEY[problem])}</p>}
        {saveFailed && <p className="text-xs text-danger" role="alert">{t('tasks.decisionGridEditor.saveFailed')}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="px-3 py-1.5 text-sm theme-text-secondary" onClick={onClose}>{t('actions.cancel')}</button>
          <button
            type="button"
            disabled={!!problem || saving}
            className="px-3 py-1.5 text-sm rounded-md bg-brand text-white disabled:opacity-50"
            data-testid="grid-editor-save"
            onClick={() => void save()}
          >
            {t('tasks.decisionGridEditor.save')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
