"use client"

/**
 * The "Lists" row of task detail — which lists a task belongs to, and the
 * search-and-chips editor for changing that.
 *
 * Extracted from TaskFieldEditors.tsx (AWTD-1002) for the reason
 * TaskDetailBoardStateRow and TaskDetailDescriptionRow were before it: that
 * file is budgeted by tests/rules/oversized-files-ratchet.test.ts, and the
 * "Waiting on" row it had to gain would have pushed it over. Rather than raise
 * the number, the largest self-contained block left there moved out — so the
 * file ends up smaller than it was before the feature, which is what the
 * ratchet is for.
 *
 * Self-contained by construction: the four helpers that serve only this row
 * (save, cancel, the suggestion filter and the per-list privacy icon) came with
 * it, so nothing about list editing is decided in two places. The editing STATE
 * still lives in useTaskDetailState and arrives as props, because task detail's
 * outside-click handling needs the same refs.
 */

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { selectableLists } from "@/lib/status-lists"
import { filterLabelLists, isLabelList } from "@/lib/list-flavors"
import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'
import { TaskFieldRow } from "./TaskFieldRow"
import { Globe, Users, X, Check, Hash, List as ListIcon, Tag } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"
import type { Task, TaskList } from "@/types/task"

interface TaskDetailListsRowProps {
  task: Task
  availableLists: TaskList[]
  onUpdate: (task: Task) => void
  readOnly?: boolean

  editingLists: boolean
  setEditingLists: (value: boolean) => void
  tempLists: TaskList[]
  setTempLists: (value: TaskList[]) => void
  listSearchTerm: string
  setListSearchTerm: (value: string) => void
  showListSuggestions: boolean
  setShowListSuggestions: (value: boolean) => void
  selectedSuggestionIndex: number
  listSearchRef: React.MutableRefObject<HTMLDivElement | null>
  listInputRef: React.MutableRefObject<HTMLInputElement | null>
}

export function TaskDetailListsRow({
  task,
  availableLists,
  onUpdate,
  readOnly,
  editingLists,
  setEditingLists,
  tempLists,
  setTempLists,
  listSearchTerm,
  setListSearchTerm,
  showListSuggestions,
  setShowListSuggestions,
  selectedSuggestionIndex,
  listSearchRef,
  listInputRef,
}: TaskDetailListsRowProps) {
  const { t } = useTranslations()

  const handleSaveLists = () => {
    onUpdate({ ...task, lists: tempLists })
    setEditingLists(false)
    setListSearchTerm('')
  }

  const handleCancelLists = () => {
    setTempLists(task.lists || [])
    setEditingLists(false)
    setListSearchTerm('')
  }

  // List filtering
  const getFilteredLists = () => {
    const selectedListIds = new Set(tempLists.map(l => l.id))
    // Domain lists remain task destinations; label lists are tags that can also
    // be applied here. Both exclude virtual/status machinery.
    const labels = filterLabelLists(availableLists).filter(list => !(list as { isVirtual?: boolean }).isVirtual)
    return [...selectableLists(availableLists), ...labels]
      .filter(list => !selectedListIds.has(list.id))
      .filter(list => {
        if (!listSearchTerm) return true
        return list.name.toLowerCase().includes(listSearchTerm.toLowerCase())
      })
      .slice(0, 10)
  }

  const getListPrivacyIcon = (list: any, useWhiteColor = false) => {
    if (isLabelList(list)) {
      return <Tag className={`w-3 h-3 ${useWhiteColor ? 'text-white' : ''}`} style={useWhiteColor ? undefined : { color: list.color || DEFAULT_LIST_COLOR }} />
    } else if (list.privacy === 'PUBLIC') {
      return <Globe className={`w-3 h-3 ${useWhiteColor ? 'text-white' : ''}`} />
    } else if (list.privacy === 'SHARED') {
      return <Users className={`w-3 h-3 ${useWhiteColor ? 'text-white' : ''}`} />
    } else {
      // Private list - use hashtag with white color for solid badges, list color otherwise
      return <Hash className="w-3 h-3" style={{ color: useWhiteColor ? 'white' : (list.color || DEFAULT_LIST_COLOR) }} />
    }
  }

  return (
    <TaskFieldRow label={t('navigation.lists')} icon={<ListIcon className="w-4 h-4" />} align="start">
      {editingLists ? (
        <div className="space-y-3">
          {/* Search input with autocomplete */}
          <div className="relative" ref={listSearchRef}>
            {/* Selected lists as chips - INSIDE listSearchRef */}
            {tempLists.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {tempLists.map((list) => (
                  <Badge
                    key={list.id}
                    variant="secondary"
                    className="flex items-center gap-1 pr-1 cursor-pointer"
                    style={{ backgroundColor: list.color, color: 'white' }}
                  >
                    {getListPrivacyIcon(list, true)}
                    {list.name}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setTempLists(tempLists.filter((l) => l.id !== list.id))
                      }}
                      className="ml-1 hover:bg-black/20 rounded-full p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <input
              ref={listInputRef}
              type="text"
              value={listSearchTerm}
              onChange={(e) => {
                setListSearchTerm(e.target.value)
                setShowListSuggestions(true)
              }}
              onFocus={() => setShowListSuggestions(true)}
              placeholder="Search lists..."
              className="w-full px-3 py-2 border rounded-md bg-gray-700 border-gray-600 text-white placeholder-gray-400"
            />

            {/* Suggestions dropdown */}
            {showListSuggestions && getFilteredLists().length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-gray-700 border border-gray-600 rounded-md shadow-lg max-h-60 overflow-auto">
                {getFilteredLists().map((list, index) => (
                  <div
                    key={list.id}
                    className={`px-3 py-2 cursor-pointer ${
                      index === selectedSuggestionIndex ? 'bg-gray-600' : 'hover:bg-gray-600'
                    } flex items-center gap-2`}
                    onClick={() => {
                      setTempLists([...tempLists, list])
                      setListSearchTerm('')
                      setShowListSuggestions(false)
                    }}
                  >
                    {getListPrivacyIcon(list)}
                    <span className="text-white">{list.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancelLists}
            >
              <X className="w-4 h-4 mr-1" />
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSaveLists}
            >
              <Check className="w-4 h-4 mr-1" />
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={`flex flex-wrap gap-2 px-2 py-1 rounded ${!readOnly ? 'cursor-pointer theme-surface-hover' : ''}`}
          onClick={() => !readOnly && setEditingLists(true)}
        >
          {task.lists && task.lists.length > 0 ? (
            task.lists.filter(list => list != null).map((list) => (
              <Badge
                key={list.id}
                variant="secondary"
                className="flex items-center gap-1"
                style={{ backgroundColor: list.color, color: 'white' }}
              >
                {getListPrivacyIcon(list, true)}
                {list.name}
              </Badge>
            ))
          ) : (
            <span className="theme-text-muted">No lists</span>
          )}
        </div>
      )}
    </TaskFieldRow>
  )
}
