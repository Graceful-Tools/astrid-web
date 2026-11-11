"use client"

import React, { createContext, useContext, useEffect, useState } from "react"

import {
  DEFAULT_ROW_TITLE_LINES,
  ROW_TITLE_CLASSES,
  ROW_TITLE_STORAGE_KEY,
  parseRowTitleLines,
  rowTitleClass,
  type RowTitleLines,
} from "@/lib/design/row-title"

export type Theme = "light" | "dark" | "ocean"

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  /** How many lines a row's title may take. Per machine, like the theme. */
  rowTitleLines: RowTitleLines
  setRowTitleLines: (lines: RowTitleLines) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
}

export function ThemeProvider({ children, defaultTheme = "ocean" }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme)
  const [rowTitleLines, setRowTitleLinesState] = useState<RowTitleLines>(DEFAULT_ROW_TITLE_LINES)

  useEffect(() => {
    setRowTitleLinesState(parseRowTitleLines(localStorage.getItem(ROW_TITLE_STORAGE_KEY)))
  }, [])

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove(...ROW_TITLE_CLASSES)
    root.classList.add(rowTitleClass(rowTitleLines))
  }, [rowTitleLines])

  // Stored on change, not in the effect above: that one also runs with the
  // default before the stored value has been read, and would overwrite it.
  const setRowTitleLines = (lines: RowTitleLines) => {
    localStorage.setItem(ROW_TITLE_STORAGE_KEY, lines)
    setRowTitleLinesState(lines)
  }

  useEffect(() => {
    // Load theme from localStorage on mount
    const storedTheme = localStorage.getItem("astrid-theme") as Theme | null
    if (storedTheme && (storedTheme === "light" || storedTheme === "dark" || storedTheme === "ocean")) {
      setTheme(storedTheme)
    } else {
      // No stored choice: the brand's starting theme (BRAND.defaultTheme).
      setTheme(defaultTheme)
    }
  }, [defaultTheme])

  useEffect(() => {
    // Save theme to localStorage when it changes
    localStorage.setItem("astrid-theme", theme)

    // Apply theme to document root
    const root = window.document.documentElement
    root.classList.remove("light", "dark", "ocean")
    root.classList.add(theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => {
      if (prev === "light") return "dark"
      if (prev === "dark") return "ocean"
      return "light"
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, rowTitleLines, setRowTitleLines }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}