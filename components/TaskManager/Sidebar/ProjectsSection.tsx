"use client"

/**
 * The sidebar's Projects section (AWTD-1660), drawn only for people with
 * Project Mode (`useProjectMode`). Each project opens its multi-list board and
 * expands to show its lists; any list in the sidebar can be dragged onto an
 * open board to add it as a row.
 */
import React from "react"
import { ChevronDown, ChevronRight, FolderKanban } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n/client"
import { useProjectMode } from "@/hooks/use-project-mode"
import { useLoadedProjects } from "@/hooks/use-loaded-projects"
import { isDomainList } from "@/lib/list-flavors"
import type { TaskList } from "@/types/task"
import { ListItem } from "./ListItem"

interface ProjectsSectionProps {
  lists: TaskList[]
  isMobile: boolean
  selectedProjectId: string | null
  selectedListId: string
  onSelectProject: (projectId: string) => void
  onListClick: (listId: string) => void
  getTaskCountForList: (listId: string) => number
}

export function ProjectsSection({
  lists,
  isMobile,
  selectedProjectId,
  selectedListId,
  onSelectProject,
  onListClick,
  getTaskCountForList,
}: ProjectsSectionProps) {
  const { t } = useTranslations()
  const enabled = useProjectMode()
  const projects = useLoadedProjects()
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())

  if (!enabled || projects.length === 0) return null

  const toggle = (projectId: string) => {
    setExpanded(previous => {
      const next = new Set(previous)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const sorted = [...projects].sort((a, b) => (a.name || "").localeCompare(b.name || ""))

  return (
    <div className="p-3 mt-4" data-testid="sidebar-projects">
      <div className="text-caption2 font-medium opacity-50 tracking-wide mb-2 px-2">
        {t("projectMode.projectsHeading")}
      </div>
      <div className="space-y-1">
        {sorted.map(project => {
          const name = project.name || project.key || ""
          const isOpen = expanded.has(project.id)
          const isSelected = selectedProjectId === project.id
          const projectLists = lists
            .filter(list => list.projectId === project.id && isDomainList(list))
            .filter((list, index, self) => self.findIndex(other => other.id === list.id) === index)
          return (
            <div key={project.id} data-testid={`sidebar-project-${project.id}`}>
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0 theme-text-muted hover:theme-text-primary"
                  aria-expanded={isOpen}
                  aria-label={t(isOpen ? "projectMode.hideLists" : "projectMode.showLists", { name })}
                  data-testid={`sidebar-project-${project.id}-toggle`}
                  onClick={() => toggle(project.id)}
                >
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  className={`min-w-0 flex-1 justify-start ${isMobile ? "mobile-list-item text-left" : ""} ${
                    isSelected
                      ? "bg-theme-selected text-theme-selected font-medium"
                      : "theme-text-secondary hover:theme-text-primary hover:theme-bg-hover"
                  }`}
                  aria-current={isSelected ? "page" : undefined}
                  aria-label={t("projectMode.openBoard", { name })}
                  data-testid={`sidebar-project-${project.id}-open`}
                  onClick={() => onSelectProject(project.id)}
                >
                  <FolderKanban className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{name}</span>
                </Button>
              </div>
              {isOpen && (
                <div className="ml-6 mt-1 space-y-1" data-testid={`sidebar-project-${project.id}-lists`}>
                  {projectLists.map(list => (
                    <ListItem
                      key={list.id}
                      list={list}
                      selectedListId={selectedProjectId ? "" : selectedListId}
                      isMobile={isMobile}
                      taskCount={getTaskCountForList(list.id)}
                      onClick={onListClick}
                      listDraggable
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
