/**
 * I18n Translation Tests
 *
 * Tests to ensure all translation files are properly structured,
 * all keys exist across locales, and translations are being applied.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import enTranslations from '@/lib/i18n/locales/en.json'
import esTranslations from '@/lib/i18n/locales/es.json'
import frTranslations from '@/lib/i18n/locales/fr.json'
import deTranslations from '@/lib/i18n/locales/de.json'

// Helper function to get all keys from a nested object (flattened with dots)
function getAllKeys(obj: Record<string, any>, prefix = ''): string[] {
  const keys: string[] = []
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      keys.push(...getAllKeys(obj[key], fullKey))
    } else {
      keys.push(fullKey)
    }
  }
  return keys
}

describe('I18n Translations', () => {
  const enKeys = getAllKeys(enTranslations)
  const esKeys = getAllKeys(esTranslations)
  const frKeys = getAllKeys(frTranslations)
  const deKeys = getAllKeys(deTranslations)

  describe('English translations (base locale)', () => {
    it('should have all required top-level sections', () => {
      expect(enTranslations).toHaveProperty('search')
      expect(enTranslations).toHaveProperty('listHeaders')
      expect(enTranslations).toHaveProperty('settingsPages')
      expect(enTranslations).toHaveProperty('emptyState')
      expect(enTranslations).toHaveProperty('common')
      expect(enTranslations).toHaveProperty('messages')
    })

    it('should have search translations', () => {
      expect(enTranslations.search.placeholder).toBe('Search for tasks and users')
      expect(enTranslations.search.noResults).toBe('No results found')
      expect(enTranslations.search.searching).toBe('Searching...')
    })

    it('should have list header translations', () => {
      expect(enTranslations.listHeaders.myTasks).toBe('My Tasks')
      expect(enTranslations.listHeaders.myTasksDescription).toBe('All your tasks')
      expect(enTranslations.listHeaders.today).toBe('Today')
      expect(enTranslations.listHeaders.todayDescription).toBe('Tasks due today')
      expect(enTranslations.listHeaders.assigned).toBe('Assigned')
      expect(enTranslations.listHeaders.notInList).toBe('Not in List')
      expect(enTranslations.listHeaders.public).toBe('Public')
    })

    it('should have settings pages translations', () => {
      expect(enTranslations.settingsPages.accountAccess.title).toBe('Account & Access')
      expect(enTranslations.settingsPages.appearance.title).toBe('Appearance')
      expect(enTranslations.settingsPages.remindersNotifications.title).toBe('Reminders & Notifications')
      expect(enTranslations.settingsPages.contacts.title).toBe('Contacts')
      expect(enTranslations.settingsPages.apiAccess.title).toBe('API Access')
      expect(enTranslations.settingsPages.chatgpt.title).toBe('ChatGPT Integration')
      expect(enTranslations.settingsPages.debug.title).toBe('Debug')
    })

    it('should have appearance page nested translations', () => {
      expect(enTranslations.settingsPages.appearancePage.title).toBe('Appearance and User Experience')
      expect(enTranslations.settingsPages.appearancePage.theme.title).toBe('Theme')
      expect(enTranslations.settingsPages.appearancePage.keyboard.title).toBe('Keyboard Shortcuts')
      expect(enTranslations.settingsPages.appearancePage.keyboard.viewShortcuts).toBe('View Shortcuts')
    })

    it('should have empty state translations', () => {
      expect(enTranslations.emptyState.myTasks).toContain('caught up')
      expect(enTranslations.emptyState.today).toContain('scheduled for today')
      expect(enTranslations.emptyState.featured).toContain('empty right now')
    })
  })

  describe('Spanish translations', () => {
    it('should have all required top-level sections', () => {
      expect(esTranslations).toHaveProperty('search')
      expect(esTranslations).toHaveProperty('listHeaders')
      expect(esTranslations).toHaveProperty('settingsPages')
    })

    it('should have search translations in Spanish', () => {
      expect(esTranslations.search.placeholder).toBe('Buscar tareas y usuarios')
      expect(esTranslations.search.noResults).toBe('No se encontraron resultados')
      expect(esTranslations.search.searching).toBe('Buscando...')
    })

    it('should have list header translations in Spanish', () => {
      expect(esTranslations.listHeaders.myTasks).toBe('Mis Tareas')
      expect(esTranslations.listHeaders.today).toBe('Hoy')
      expect(esTranslations.listHeaders.assigned).toBe('Asignadas')
    })

    it('should have settings pages translations in Spanish', () => {
      expect(esTranslations.settingsPages.accountAccess.title).toBe('Cuenta y Acceso')
      expect(esTranslations.settingsPages.appearance.title).toBe('Apariencia')
    })
  })

  describe('French translations', () => {
    it('should have all required top-level sections', () => {
      expect(frTranslations).toHaveProperty('search')
      expect(frTranslations).toHaveProperty('listHeaders')
      expect(frTranslations).toHaveProperty('settingsPages')
    })

    it('should have search translations in French', () => {
      expect(frTranslations.search.placeholder).toBe('Rechercher des tâches et des utilisateurs')
      expect(frTranslations.search.noResults).toBe('Aucun résultat trouvé')
    })

    it('should have list header translations in French', () => {
      expect(frTranslations.listHeaders.myTasks).toBe('Mes Tâches')
      expect(frTranslations.listHeaders.today).toBe("Aujourd'hui")
    })
  })

  describe('German translations', () => {
    it('should have all required top-level sections', () => {
      expect(deTranslations).toHaveProperty('search')
      expect(deTranslations).toHaveProperty('listHeaders')
      expect(deTranslations).toHaveProperty('settingsPages')
    })

    it('should have search translations in German', () => {
      expect(deTranslations.search.placeholder).toBe('Nach Aufgaben und Benutzern suchen')
      expect(deTranslations.search.noResults).toBe('Keine Ergebnisse gefunden')
    })

    it('should have list header translations in German', () => {
      expect(deTranslations.listHeaders.myTasks).toBe('Meine Aufgaben')
      expect(deTranslations.listHeaders.today).toBe('Heute')
    })
  })

  describe('Translation key consistency', () => {
    // Critical keys that must exist in all locales
    const criticalKeys = [
      'search.placeholder',
      'search.noResults',
      'search.searching',
      'listHeaders.myTasks',
      'listHeaders.myTasksDescription',
      'listHeaders.today',
      'listHeaders.todayDescription',
      'listHeaders.assigned',
      'listHeaders.assignedDescription',
      'listHeaders.notInList',
      'listHeaders.notInListDescription',
      'listHeaders.public',
      'listHeaders.publicDescription',
      'settingsPages.accountAccess.title',
      'settingsPages.accountAccess.description',
      'settingsPages.appearance.title',
      'settingsPages.appearance.description',
      'settingsPages.remindersNotifications.title',
      'settingsPages.remindersNotifications.description',
    ]

    it('should have all critical keys in Spanish', () => {
      criticalKeys.forEach(key => {
        expect(esKeys, `Missing key: ${key}`).toContain(key)
      })
    })

    it('should have all critical keys in French', () => {
      criticalKeys.forEach(key => {
        expect(frKeys, `Missing key: ${key}`).toContain(key)
      })
    })

    it('should have all critical keys in German', () => {
      criticalKeys.forEach(key => {
        expect(deKeys, `Missing key: ${key}`).toContain(key)
      })
    })
  })

  describe('Translation values are not empty', () => {
    it('should not have empty string values in English', () => {
      const emptyKeys = enKeys.filter(key => {
        const value = key.split('.').reduce((obj: any, k) => obj?.[k], enTranslations)
        return value === ''
      })
      expect(emptyKeys, `Empty values found for keys: ${emptyKeys.join(', ')}`).toHaveLength(0)
    })

    it('should not have empty string values in Spanish', () => {
      const emptyKeys = esKeys.filter(key => {
        const value = key.split('.').reduce((obj: any, k) => obj?.[k], esTranslations)
        return value === ''
      })
      expect(emptyKeys, `Empty values found for keys: ${emptyKeys.join(', ')}`).toHaveLength(0)
    })
  })

  describe('Translation values are localized (not just English)', () => {
    it('Spanish translations should differ from English for common words', () => {
      expect(esTranslations.search.placeholder).not.toBe(enTranslations.search.placeholder)
      expect(esTranslations.listHeaders.myTasks).not.toBe(enTranslations.listHeaders.myTasks)
      expect(esTranslations.listHeaders.today).not.toBe(enTranslations.listHeaders.today)
    })

    it('French translations should differ from English for common words', () => {
      expect(frTranslations.search.placeholder).not.toBe(enTranslations.search.placeholder)
      expect(frTranslations.listHeaders.myTasks).not.toBe(enTranslations.listHeaders.myTasks)
      expect(frTranslations.listHeaders.today).not.toBe(enTranslations.listHeaders.today)
    })

    it('German translations should differ from English for common words', () => {
      expect(deTranslations.search.placeholder).not.toBe(enTranslations.search.placeholder)
      expect(deTranslations.listHeaders.myTasks).not.toBe(enTranslations.listHeaders.myTasks)
      expect(deTranslations.listHeaders.today).not.toBe(enTranslations.listHeaders.today)
    })
  })
})

/**
 * Reuse Phase 2 (task 5fac84e8): the add-task placeholder was hardcoded English
 * in several components ("Add a task", "Add task"), so non-English users saw
 * English there regardless of locale. One key now backs all of them, mirroring
 * the iOS key name (iOS: tasks.add_task_placeholder).
 */
describe('add-task placeholder is a single translated key (task 5fac84e8)', () => {
  const locales = fs.readdirSync(path.join(process.cwd(), 'lib/i18n/locales'))
    .filter(f => f.endsWith('.json'))

  it('exists in every locale', () => {
    for (const file of locales) {
      const messages = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'lib/i18n/locales', file), 'utf8'),
      )
      expect(messages.tasks?.addTaskPlaceholder, `${file} is missing tasks.addTaskPlaceholder`).toBeTruthy()
    }
  })

  it('is actually translated, not the English string copied everywhere', () => {
    const read = (f: string) => JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'lib/i18n/locales', f), 'utf8'),
    ).tasks.addTaskPlaceholder
    const en = read('en.json')
    for (const file of locales.filter(f => f !== 'en.json')) {
      expect(read(file), `${file} still holds the English string`).not.toBe(en)
    }
  })

  it('leaves no hardcoded add-task placeholder in components', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.tsx?$/.test(entry.name)) continue
        const src = fs.readFileSync(full, 'utf8')
        if (/placeholder=["'](Add a task|Add task)["']/.test(src)) offenders.push(full)
      }
    }
    walk(path.join(process.cwd(), 'components'))
    expect(offenders, `hardcoded placeholder in: ${offenders.join(', ')}`).toEqual([])
  })
})
