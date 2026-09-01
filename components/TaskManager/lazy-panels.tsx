"use client"

import React from "react"
import dynamic from "next/dynamic"

function PanelLoadingFallback({ modal = false }: { modal?: boolean }) {
  return (
    <div
      aria-busy="true"
      data-lazy-panel-loading
      className={
        modal
          ? "fixed inset-0 z-[9999] bg-black/50"
          : "flex h-full min-h-24 w-full items-center justify-center"
      }
    >
      <div className="h-5 w-5 animate-spin rounded-full border-2 theme-border border-t-transparent" />
    </div>
  )
}

const TaskDetailPanel = dynamic(
  () => import("../task-detail").then(module => module.TaskDetail),
  { ssr: false, loading: () => <PanelLoadingFallback /> },
)
const SettingsPanel = dynamic(
  () => import("../Settings/SettingsPanel"),
  { ssr: false, loading: () => <PanelLoadingFallback /> },
)
const SettingsDetailPanel = dynamic(
  () => import("../Settings/SettingsDetailPanel"),
  { ssr: false, loading: () => <PanelLoadingFallback /> },
)
const ChatPanel = dynamic(
  () => import("../chat/ChatPanel").then(module => module.ChatPanel),
  { ssr: false, loading: () => <PanelLoadingFallback /> },
)
const PublicListsBrowser = dynamic(
  () => import("../public-lists-browser").then(module => module.PublicListsBrowser),
  { ssr: false, loading: () => <PanelLoadingFallback modal /> },
)
const AddListModal = dynamic(
  () => import("../add-list-modal").then(module => module.AddListModal),
  { ssr: false, loading: () => <PanelLoadingFallback modal /> },
)
const ImagePicker = dynamic(
  () => import("../image-picker").then(module => module.ImagePicker),
  { ssr: false, loading: () => <PanelLoadingFallback /> },
)
const OwnerLeaveDialog = dynamic(
  () => import("../owner-leave-dialog").then(module => module.OwnerLeaveDialog),
  { ssr: false, loading: () => <PanelLoadingFallback modal /> },
)
const KeyboardShortcutsMenu = dynamic(
  () => import("../keyboard-shortcuts-menu").then(module => module.KeyboardShortcutsMenu),
  { ssr: false, loading: () => <PanelLoadingFallback modal /> },
)
const CommandPaletteDialog = dynamic(
  () => import("../command-palette-dialog").then(module => module.CommandPaletteDialog),
  { ssr: false, loading: () => <PanelLoadingFallback modal /> },
)
const ProjectStatusBoard = dynamic(
  () => import("../project-status-board").then(module => module.ProjectStatusBoard),
  { ssr: false, loading: () => <PanelLoadingFallback /> },
)
const ListSettingsHost = dynamic(
  () => import("./MainContent/ListSettingsHost").then(module => module.ListSettingsHost),
  { ssr: false, loading: () => null },
)

export function LazyTaskDetail(props: React.ComponentProps<typeof TaskDetailPanel>) {
  return <TaskDetailPanel {...props} />
}

export function LazySettingsPanel(props: React.ComponentProps<typeof SettingsPanel>) {
  return <SettingsPanel {...props} />
}

export function LazySettingsDetailPanel(props: React.ComponentProps<typeof SettingsDetailPanel>) {
  return <SettingsDetailPanel {...props} />
}

export function LazyChatPanel(props: React.ComponentProps<typeof ChatPanel>) {
  return <ChatPanel {...props} />
}

export function LazyPublicListsBrowser(props: React.ComponentProps<typeof PublicListsBrowser>) {
  return <PublicListsBrowser {...props} />
}

export function LazyAddListModal(props: React.ComponentProps<typeof AddListModal>) {
  return <AddListModal {...props} />
}

export function LazyImagePicker(props: React.ComponentProps<typeof ImagePicker>) {
  return <ImagePicker {...props} />
}

export function LazyOwnerLeaveDialog(props: React.ComponentProps<typeof OwnerLeaveDialog>) {
  return <OwnerLeaveDialog {...props} />
}

export function LazyKeyboardShortcutsMenu(props: React.ComponentProps<typeof KeyboardShortcutsMenu>) {
  return <KeyboardShortcutsMenu {...props} />
}

export function LazyCommandPaletteDialog(props: React.ComponentProps<typeof CommandPaletteDialog>) {
  return <CommandPaletteDialog {...props} />
}

export function LazyProjectStatusBoard(props: React.ComponentProps<typeof ProjectStatusBoard>) {
  return <ProjectStatusBoard {...props} />
}

export function LazyListSettingsHost(props: React.ComponentProps<typeof ListSettingsHost>) {
  return <ListSettingsHost {...props} />
}
