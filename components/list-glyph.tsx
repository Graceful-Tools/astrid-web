"use client"

import { Globe, Hash, Users } from "lucide-react"
import { getAllListMembers } from "@/lib/list-member-utils"
import type { TaskList } from "@/types/task"

type GlyphList = Pick<TaskList, "color" | "privacy"> & Parameters<typeof getAllListMembers>[0]

/**
 * The list's kind at a glance: Globe for a public list, Users for a shared
 * one, otherwise a Hash in the list's colour. Used on task-row list chips, and
 * in place of the list image where hide_list_images hides it.
 */
export function ListGlyph({ list, className = "w-3 h-3" }: { list: GlyphList; className?: string }) {
  if (list?.privacy === "PUBLIC") {
    return <Globe className={`${className} text-green-500`} aria-hidden="true" />
  }
  if (getAllListMembers(list).length > 1) {
    return <Users className={`${className} text-blue-500`} aria-hidden="true" />
  }
  return <Hash className={className} style={{ color: list.color }} aria-hidden="true" />
}
