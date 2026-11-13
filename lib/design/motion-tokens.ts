/**
 * The motion durations a client component needs as numbers (a `setTimeout`
 * that has to match a CSS transition). Its own module, reading only `motion`,
 * so a component that wants one duration does not ship every theme's colours
 * in its first load, as importing `designTokens` from ./tokens does
 * (the route bundle budget, scripts/check-route-bundle-budget.ts).
 */
import { motion } from '@/packages/astrid-design/tokens.resolved.json'

/** `motion.panel`: how long the task panel takes to slide in or out, in ms. */
export const PANEL_MOTION_MS: number = motion.panel.ms
