"use client"

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { X, Plus } from "lucide-react"
import type { TaskList } from "@/types/task"

export interface ListAutocompleteProps {
  /**
   * All available lists to search/select from
   */
  availableLists: TaskList[]

  /**
   * Currently selected lists
   */
  selectedLists: TaskList[]

  /**
   * Called when a list is selected
   */
  onSelect: (list: TaskList) => void

  /**
   * Called when a list is removed from selection
   */
  onRemove: (list: TaskList) => void

  /**
   * Called when user wants to create a new list
   * Receives the list name entered by user
   */
  onCreateNew?: (name: string) => void

  /**
   * Placeholder text for input
   */
  placeholder?: string

  /**
   * Whether to show create new option
   * @default true
   */
  allowCreate?: boolean

  /**
   * Custom className for the container
   */
  className?: string
}

/**
 * Shared autocomplete component for list selection
 *
 * Features:
 * - Search/filter lists by name
 * - Multi-select with chips
 * - Create new list option
 * - Keyboard navigation
 * - Accessible
 *
 * @example
 * ```typescript
 * <ListAutocomplete
 *   availableLists={lists}
 *   selectedLists={selectedLists}
 *   onSelect={(list) => setSelectedLists([...selectedLists, list])}
 *   onRemove={(list) => setSelectedLists(selectedLists.filter(l => l.id !== list.id))}
 *   onCreateNew={(name) => createList({ name })}
 * />
 * ```
 */
export function ListAutocomplete({
  availableLists,
  selectedLists,
  onSelect,
  onRemove,
  onCreateNew,
  placeholder = "Type to search lists or create new...",
  allowCreate = true,
  className = ""
}: ListAutocompleteProps) {
  const [inputValue, setInputValue] = useState("")
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Filter lists based on input, excluding already selected
  const filteredLists = useMemo(() => {
    const selectedIds = new Set(selectedLists.map(l => l.id))
    const query = inputValue.toLowerCase().trim()

    if (!query) return []

    return availableLists
      .filter(list => !selectedIds.has(list.id))
      .filter(list => list.name.toLowerCase().includes(query))
      .slice(0, 10) // Limit results
  }, [availableLists, selectedLists, inputValue])

  const handleSelect = (list: TaskList) => {
    onSelect(list)
    setInputValue("")
    setShowSuggestions(false)
  }

  const handleRemove = (list: TaskList) => {
    onRemove(list)
  }

  const handleCreateNew = () => {
    const name = inputValue.trim()
    if (name && onCreateNew) {
      onCreateNew(name)
      setInputValue("")
      setShowSuggestions(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Backspace with empty input removes last selected list
    if (e.key === 'Backspace' && !inputValue && selectedLists.length > 0) {
      onRemove(selectedLists[selectedLists.length - 1])
    }

    // Enter creates new list if no matches
    if (e.key === 'Enter' && filteredLists.length === 0 && inputValue.trim() && allowCreate) {
      e.preventDefault()
      handleCreateNew()
    }

    // Enter selects first match if available
    if (e.key === 'Enter' && filteredLists.length > 0) {
      e.preventDefault()
      handleSelect(filteredLists[0])
    }

    // Escape closes suggestions
    if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  return (
    <div className={className}>
      {/* Selected lists chips */}
      {selectedLists.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 bg-theme-secondary border border-theme rounded-md mb-2">
          {selectedLists.map((list) => (
            <Badge
              key={list.id}
              variant="secondary"
              className="bg-brand text-brand-foreground hover:bg-brand-hover group cursor-pointer"
              onClick={() => handleRemove(list)}
            >
              {list.name}
              <X className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
            </Badge>
          ))}
        </div>
      )}

      {/* Autocomplete input */}
      <div className="relative">
        <Input
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            setShowSuggestions(true)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => inputValue && setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          className="bg-theme-input border-theme-input text-theme-primary placeholder:text-theme-placeholder"
        />

        {/* Dropdown suggestions */}
        {showSuggestions && inputValue && (
          <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-theme-surface border border-theme-surface rounded-md shadow-lg max-h-40 overflow-y-auto">
            {filteredLists.length > 0 ? (
              filteredLists.map((list) => (
                <div
                  key={list.id}
                  onClick={() => handleSelect(list)}
                  className="px-3 py-2 hover:bg-theme-hover cursor-pointer text-theme-primary flex items-center justify-between"
                >
                  <span>{list.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {list.privacy === 'PRIVATE' ? 'Private' : list.privacy === 'SHARED' ? 'Shared' : 'Public'}
                  </Badge>
                </div>
              ))
            ) : allowCreate && onCreateNew && inputValue.trim() ? (
              <div
                onClick={handleCreateNew}
                className="px-3 py-2 hover:bg-theme-hover cursor-pointer text-theme-primary"
              >
                <div className="flex items-center space-x-2">
                  <Plus className="w-4 h-4 text-success" />
                  <span>Create new list: &quot;{inputValue}&quot;</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Help text */}
      <div className="text-xs text-theme-muted mt-2">
        Type to search existing lists{allowCreate && ' or create a new private list'}. Use backspace to remove selected lists.
      </div>
    </div>
  )
}
