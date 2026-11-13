/**
 * The crash page's words, by locale (AWTD-1613).
 *
 * `app/global-error.tsx` replaces the root layout when the layout itself throws, so it renders
 * with no NextIntlClientProvider and cannot call `t()`. It also sits in every route's first
 * load, so it carries only English (lib/i18n/global-error-english.ts) and imports this table
 * when it actually renders; if that import fails too, the page stays in English.
 *
 * The locale files stay the source of truth: tests/i18n/global-error-messages-awtd-1613.test.tsx
 * fails when an entry here differs from `errorPages.*` in lib/i18n/locales/<locale>.json. To
 * change a string, change the locale file and copy it here.
 */
import { defaultLocale, locales, type Locale } from './config'
import { GLOBAL_ERROR_ENGLISH, type GlobalErrorMessages } from './global-error-english'

export const GLOBAL_ERROR_MESSAGES: Record<Locale, GlobalErrorMessages> = {
  en: GLOBAL_ERROR_ENGLISH,
  es: {
    title: 'Algo salió mal',
    description: 'Se produjo un error grave. Intenta recargar la página.',
    tryAgain: 'Intentar de nuevo',
    goHome: 'Ir al inicio',
  },
  fr: {
    title: 'Une erreur s’est produite',
    description: 'Une erreur critique s’est produite. Veuillez actualiser la page.',
    tryAgain: 'Réessayer',
    goHome: 'Retour à l’accueil',
  },
  de: {
    title: 'Etwas ist schiefgelaufen',
    description: 'Ein schwerwiegender Fehler ist aufgetreten. Bitte lade die Seite neu.',
    tryAgain: 'Erneut versuchen',
    goHome: 'Zur Startseite',
  },
  it: {
    title: 'Qualcosa è andato storto',
    description: 'Si è verificato un errore critico. Prova a ricaricare la pagina.',
    tryAgain: 'Riprova',
    goHome: 'Vai alla home',
  },
  pt: {
    title: 'Algo deu errado',
    description: 'Ocorreu um erro crítico. Tente recarregar a página.',
    tryAgain: 'Tentar novamente',
    goHome: 'Ir para o início',
  },
  nl: {
    title: 'Er is iets misgegaan',
    description: 'Er is een kritieke fout opgetreden. Probeer de pagina te vernieuwen.',
    tryAgain: 'Opnieuw proberen',
    goHome: 'Naar home',
  },
  ru: {
    title: 'Что-то пошло не так',
    description: 'Произошла критическая ошибка. Попробуйте обновить страницу.',
    tryAgain: 'Повторить',
    goHome: 'На главную',
  },
  ja: {
    title: '問題が発生しました',
    description: '重大なエラーが発生しました。ページを再読み込みしてください。',
    tryAgain: '再試行',
    goHome: 'ホームへ',
  },
  ko: {
    title: '문제가 발생했습니다',
    description: '심각한 오류가 발생했습니다. 페이지를 새로고침해 보세요.',
    tryAgain: '다시 시도',
    goHome: '홈으로',
  },
  'zh-CN': {
    title: '出了点问题',
    description: '发生了严重错误。请尝试刷新页面。',
    tryAgain: '重试',
    goHome: '返回首页',
  },
  'zh-TW': {
    title: '發生錯誤',
    description: '發生嚴重錯誤。請嘗試重新整理頁面。',
    tryAgain: '再試一次',
    goHome: '返回首頁',
  },
}

/**
 * The locale a crashed page was showing, from its address. Routing is `localePrefix:
 * 'as-needed'`, so an address with no locale segment is the default locale.
 */
export function globalErrorLocale(pathname: string | null | undefined): Locale {
  const segment = pathname?.split('/')[1]?.toLowerCase()
  return locales.find((locale) => locale.toLowerCase() === segment) ?? defaultLocale
}
