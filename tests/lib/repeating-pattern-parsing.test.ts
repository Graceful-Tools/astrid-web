import { describe, it, expect } from 'vitest'
import { buildTaskList } from '../fixtures/domain'
import { parseTaskInput } from '@/lib/task-manager-utils'
import type { TaskList } from '@/types/task'

describe('Repeating Pattern Parsing', () => {
  const mockLists: TaskList[] = [
    buildTaskList({
      id: 'list-1',
      name: 'Shopping',
      ownerId: 'user-1',
      color: '#3b82f6',
      privacy: 'PRIVATE',
      createdAt: new Date(),
      updatedAt: new Date(),
      isVirtual: false,
    }),
  ]

  const mockSession = {
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
    },
  }

  describe('Simple repeating patterns', () => {
    it('should parse "daily" as daily repeating', () => {
      const result = parseTaskInput('daily exercise', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('exercise')
      expect(result.repeating).toBe('daily')
      expect(result.customRepeatingData).toBeNull()
    })

    it('should parse "weekly" as weekly repeating', () => {
      const result = parseTaskInput('weekly report', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('report')
      expect(result.repeating).toBe('weekly')
      expect(result.customRepeatingData).toBeNull()
    })

    it('should parse "monthly" as monthly repeating', () => {
      const result = parseTaskInput('monthly budget review', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('budget review')
      expect(result.repeating).toBe('monthly')
      expect(result.customRepeatingData).toBeNull()
    })

    it('should parse "yearly" as yearly repeating', () => {
      const result = parseTaskInput('yearly tax filing', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('tax filing')
      expect(result.repeating).toBe('yearly')
      expect(result.customRepeatingData).toBeNull()
    })

    it('should parse "annually" as yearly repeating', () => {
      const result = parseTaskInput('annually renew license', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('renew license')
      expect(result.repeating).toBe('yearly')
      expect(result.customRepeatingData).toBeNull()
    })

    it('should parse "every day" as daily repeating', () => {
      const result = parseTaskInput('every day take vitamins', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('take vitamins')
      expect(result.repeating).toBe('daily')
    })

    it('should parse "every week" as weekly repeating', () => {
      const result = parseTaskInput('every week clean house', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('clean house')
      expect(result.repeating).toBe('weekly')
    })

    it('should parse "every month" as monthly repeating', () => {
      const result = parseTaskInput('every month pay rent', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('pay rent')
      expect(result.repeating).toBe('monthly')
    })

    it('should parse "every year" as yearly repeating', () => {
      const result = parseTaskInput('every year file taxes', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('file taxes')
      expect(result.repeating).toBe('yearly')
    })
  })

  describe('Weekly repeating with specific day', () => {
    it('should parse "weekly Monday" as custom weekly repeating on Monday', () => {
      const result = parseTaskInput('weekly Monday exercise', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('exercise')
      expect(result.repeating).toBe('custom')
      expect(result.customRepeatingData).toBeDefined()
      expect(result.customRepeatingData?.unit).toBe('weeks')
      expect(result.customRepeatingData?.interval).toBe(1)
      expect(result.customRepeatingData?.weekdays).toContain('monday')
      expect(result.dueDateTime).toBeDefined()
    })

    it('should parse "weekly Tuesday" as custom weekly repeating on Tuesday', () => {
      const result = parseTaskInput('weekly Tuesday team meeting', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('team meeting')
      expect(result.repeating).toBe('custom')
      expect(result.customRepeatingData?.weekdays).toContain('tuesday')
    })

    it('should parse "every week Friday" as custom weekly repeating on Friday', () => {
      const result = parseTaskInput('every week Friday review', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('review')
      expect(result.repeating).toBe('custom')
      expect(result.customRepeatingData?.weekdays).toContain('friday')
    })

    it('should be case-insensitive for day names', () => {
      const result = parseTaskInput('weekly MONDAY exercise', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('exercise')
      expect(result.repeating).toBe('custom')
      expect(result.customRepeatingData?.weekdays).toContain('monday')
    })

    it('should handle day name in middle of sentence', () => {
      const result = parseTaskInput('go to weekly Monday exercise class', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('go to exercise class')
      expect(result.repeating).toBe('custom')
      expect(result.customRepeatingData?.weekdays).toContain('monday')
    })
  })

  describe('Weekly repeating with multiple days', () => {
    it('should parse "weekly Monday and Wednesday" as custom weekly with multiple days', () => {
      const result = parseTaskInput('weekly Monday and Wednesday workout', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('workout')
      expect(result.repeating).toBe('custom')
      expect(result.customRepeatingData?.weekdays).toContain('monday')
      expect(result.customRepeatingData?.weekdays).toContain('wednesday')
      expect(result.customRepeatingData?.weekdays).toHaveLength(2)
    })

    it('should parse "weekly Monday, Wednesday, Friday" as custom weekly with three days', () => {
      const result = parseTaskInput('weekly Monday, Wednesday, Friday workout', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('workout')
      expect(result.repeating).toBe('custom')
      expect(result.customRepeatingData?.weekdays).toContain('monday')
      expect(result.customRepeatingData?.weekdays).toContain('wednesday')
      expect(result.customRepeatingData?.weekdays).toContain('friday')
      expect(result.customRepeatingData?.weekdays).toHaveLength(3)
    })
  })

  describe('Repeating patterns with other parsing features', () => {
    it('should handle repeating with priority', () => {
      const result = parseTaskInput('daily exercise high priority', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('exercise')
      expect(result.repeating).toBe('daily')
      expect(result.priority).toBe(2)
    })

    it('should handle repeating with hashtags', () => {
      const result = parseTaskInput('weekly report #shopping', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('report')
      expect(result.repeating).toBe('weekly')
      expect(result.listIds).toContain('list-1')
    })

    it('should handle weekly day with priority', () => {
      const result = parseTaskInput('weekly Monday exercise high priority', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('exercise')
      expect(result.repeating).toBe('custom')
      expect(result.customRepeatingData?.weekdays).toContain('monday')
      expect(result.priority).toBe(2)
    })

    it('should handle weekly day with date already set', () => {
      // "weekly Monday" should set Monday as the due date via the repeating pattern
      const result = parseTaskInput('weekly Monday exercise', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('exercise')
      expect(result.repeating).toBe('custom')
      expect(result.dueDateTime).toBeDefined()
      // dueDateTime should be set to next Monday
    })
  })

  describe('Repeating at different positions in text', () => {
    it('should parse repeating at the beginning', () => {
      const result = parseTaskInput('daily take vitamins', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('take vitamins')
      expect(result.repeating).toBe('daily')
    })

    it('should parse repeating in the middle', () => {
      const result = parseTaskInput('take daily vitamins', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('take vitamins')
      expect(result.repeating).toBe('daily')
    })

    it('should parse repeating at the end', () => {
      const result = parseTaskInput('take vitamins daily', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('take vitamins')
      expect(result.repeating).toBe('daily')
    })
  })

  describe('Edge cases', () => {
    it('should not parse partial matches', () => {
      // "biweekly" should not match "weekly"
      const result = parseTaskInput('biweekly meeting', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('biweekly meeting')
      expect(result.repeating).toBeUndefined()
    })

    it('should handle empty input', () => {
      const result = parseTaskInput('', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('')
      expect(result.repeating).toBeUndefined()
    })

    it('should handle input with only repeating keyword', () => {
      const result = parseTaskInput('daily', 'my-tasks', mockSession, mockLists)

      // Falls back to original if title becomes empty
      expect(result.title).toBe('daily')
      expect(result.repeating).toBe('daily')
    })

    it('should not set repeating if skipSmartParsing is true', () => {
      const result = parseTaskInput('daily exercise', 'my-tasks', mockSession, mockLists, true)

      expect(result.title).toBe('daily exercise')
      expect(result.repeating).toBeUndefined()
    })
  })

  describe('The original bug scenario', () => {
    it('should parse "weekly Monday exercise" as weekly repeating on Monday', () => {
      const result = parseTaskInput('weekly Monday exercise', 'my-tasks', mockSession, mockLists)

      expect(result.title).toBe('exercise')
      expect(result.repeating).toBe('custom')
      expect(result.customRepeatingData).toBeDefined()
      expect(result.customRepeatingData?.unit).toBe('weeks')
      expect(result.customRepeatingData?.interval).toBe(1)
      expect(result.customRepeatingData?.weekdays).toContain('monday')
      expect(result.dueDateTime).toBeDefined()
    })
  })

  describe('German repeating patterns', () => {
    it('should parse "täglich" as daily repeating', () => {
      const result = parseTaskInput('täglich exercise', 'my-tasks', mockSession, mockLists, false, 'de')

      expect(result.title).toBe('exercise')
      expect(result.repeating).toBe('daily')
      expect(result.customRepeatingData).toBeNull()
    })

    it('should parse "wöchentlich" as weekly repeating', () => {
      const result = parseTaskInput('wöchentlich report', 'my-tasks', mockSession, mockLists, false, 'de')

      expect(result.title).toBe('report')
      expect(result.repeating).toBe('weekly')
      expect(result.customRepeatingData).toBeNull()
    })

    it('should parse "wöchentlich montag" as custom weekly on Monday', () => {
      const result = parseTaskInput('wöchentlich montag sport', 'my-tasks', mockSession, mockLists, false, 'de')

      expect(result.title).toBe('sport')
      expect(result.repeating).toBe('custom')
      expect(result.customRepeatingData?.weekdays).toContain('monday')
    })

    it('should parse "heute" as today', () => {
      const result = parseTaskInput('heute einkaufen', 'my-tasks', mockSession, mockLists, false, 'de')

      expect(result.title).toBe('einkaufen')
      expect(result.dueDateTime).toBeDefined()
    })

    it('should parse "dringend" as highest priority', () => {
      const result = parseTaskInput('dringend anrufen', 'my-tasks', mockSession, mockLists, false, 'de')

      expect(result.title).toBe('anrufen')
      expect(result.priority).toBe(3)
    })
  })

  describe('French repeating patterns', () => {
    it('should parse "quotidien" as daily repeating', () => {
      const result = parseTaskInput('quotidien exercice', 'my-tasks', mockSession, mockLists, false, 'fr')

      expect(result.title).toBe('exercice')
      expect(result.repeating).toBe('daily')
    })

    it('should parse "hebdomadaire" as weekly repeating', () => {
      const result = parseTaskInput('hebdomadaire rapport', 'my-tasks', mockSession, mockLists, false, 'fr')

      expect(result.title).toBe('rapport')
      expect(result.repeating).toBe('weekly')
    })

    it('should parse "demain" as tomorrow', () => {
      const result = parseTaskInput('demain réunion', 'my-tasks', mockSession, mockLists, false, 'fr')

      expect(result.title).toBe('réunion')
      expect(result.dueDateTime).toBeDefined()
    })
  })

  describe('Spanish repeating patterns', () => {
    it('should parse "diario" as daily repeating', () => {
      const result = parseTaskInput('diario ejercicio', 'my-tasks', mockSession, mockLists, false, 'es')

      expect(result.title).toBe('ejercicio')
      expect(result.repeating).toBe('daily')
    })

    it('should parse "mañana" as tomorrow', () => {
      const result = parseTaskInput('mañana compras', 'my-tasks', mockSession, mockLists, false, 'es')

      expect(result.title).toBe('compras')
      expect(result.dueDateTime).toBeDefined()
    })

    it('should parse "urgente" as highest priority', () => {
      const result = parseTaskInput('urgente llamar', 'my-tasks', mockSession, mockLists, false, 'es')

      expect(result.title).toBe('llamar')
      expect(result.priority).toBe(3)
    })
  })

  describe('Chinese (Simplified) repeating patterns', () => {
    it('should parse "每天" as daily repeating', () => {
      const result = parseTaskInput('每天 锻炼', 'my-tasks', mockSession, mockLists, false, 'zh-CN')

      expect(result.title).toBe('锻炼')
      expect(result.repeating).toBe('daily')
    })

    it('should parse "每周" as weekly repeating', () => {
      const result = parseTaskInput('每周 报告', 'my-tasks', mockSession, mockLists, false, 'zh-CN')

      expect(result.title).toBe('报告')
      expect(result.repeating).toBe('weekly')
    })

    it('should parse "今天" as today', () => {
      const result = parseTaskInput('今天 购物', 'my-tasks', mockSession, mockLists, false, 'zh-CN')

      expect(result.title).toBe('购物')
      expect(result.dueDateTime).toBeDefined()
    })

    it('should parse "紧急" as highest priority', () => {
      const result = parseTaskInput('紧急 打电话', 'my-tasks', mockSession, mockLists, false, 'zh-CN')

      expect(result.title).toBe('打电话')
      expect(result.priority).toBe(3)
    })
  })

  describe('Japanese repeating patterns', () => {
    it('should parse "毎日" as daily repeating', () => {
      const result = parseTaskInput('毎日 運動', 'my-tasks', mockSession, mockLists, false, 'ja')

      expect(result.title).toBe('運動')
      expect(result.repeating).toBe('daily')
    })

    it('should parse "今日" as today', () => {
      const result = parseTaskInput('今日 買い物', 'my-tasks', mockSession, mockLists, false, 'ja')

      expect(result.title).toBe('買い物')
      expect(result.dueDateTime).toBeDefined()
    })
  })

  describe('Korean repeating patterns', () => {
    it('should parse "매일" as daily repeating', () => {
      const result = parseTaskInput('매일 운동', 'my-tasks', mockSession, mockLists, false, 'ko')

      expect(result.title).toBe('운동')
      expect(result.repeating).toBe('daily')
    })

    it('should parse "오늘" as today', () => {
      const result = parseTaskInput('오늘 쇼핑', 'my-tasks', mockSession, mockLists, false, 'ko')

      expect(result.title).toBe('쇼핑')
      expect(result.dueDateTime).toBeDefined()
    })

    it('should parse "긴급" as highest priority', () => {
      const result = parseTaskInput('긴급 전화', 'my-tasks', mockSession, mockLists, false, 'ko')

      expect(result.title).toBe('전화')
      expect(result.priority).toBe(3)
    })
  })

  describe('Locale fallback', () => {
    it('should fall back to English for unknown locale', () => {
      const result = parseTaskInput('daily exercise', 'my-tasks', mockSession, mockLists, false, 'xyz')

      expect(result.title).toBe('exercise')
      expect(result.repeating).toBe('daily')
    })

    it('should use language code without region (en-US -> en)', () => {
      const result = parseTaskInput('weekly report', 'my-tasks', mockSession, mockLists, false, 'en-US')

      expect(result.title).toBe('report')
      expect(result.repeating).toBe('weekly')
    })
  })
})