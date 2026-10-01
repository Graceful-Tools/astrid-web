"use client"

import React, { createContext, useContext, useEffect, useState } from "react"

export type Theme = "light" | "dark" | "ocean"

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
}

export function ThemeProvider({ children, defaultTheme = "ocean" }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme)

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
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
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