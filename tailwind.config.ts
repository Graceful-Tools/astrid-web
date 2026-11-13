import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

import {
  inkColors,
  ringColors,
  semanticColors,
  shadcnColors,
  themeBackgroundColors,
  themeBorderColors,
  themeTextColors,
  tokenDurations,
  tokenEasings,
  tokenOpacity,
  tokenFontSizes,
  tokenScale,
  tokenSpacing,
} from "./lib/design/tailwind-theme";

// all in fixtures is set to tailwind v3 as interims solutions

const config: Config = {
    darkMode: ["class"],
    content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
  	extend: {
  		screens: {
  			'cols2': '910px',
  		},
  		// The design tokens (docs/specs/DESIGN_SYSTEM.md). Every colour, size and
  		// duration below is a custom property from packages/astrid-design.
  		colors: {
  			...shadcnColors,
  			...semanticColors,
  		},
  		// A meaning as a glyph is its ink; as a fill, border or ring, itself.
  		textColor: { theme: themeTextColors, ...inkColors },
  		fill: inkColors,
  		stroke: inkColors,
  		// The accent as a ring is the focus border: lighter in Dark.
  		ringColor: ringColors,
  		backgroundColor: { theme: themeBackgroundColors },
  		borderColor: { theme: themeBorderColors },
  		opacity: tokenOpacity,
  		scale: tokenScale,
  		spacing: tokenSpacing,
  		transitionDuration: tokenDurations,
  		transitionTimingFunction: tokenEasings,
  		fontSize: {
  			...tokenFontSizes,
  			'display': ['2rem', { lineHeight: '2.5rem', letterSpacing: '-0.01em', fontWeight: '600' }],
  			'title': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.01em', fontWeight: '600' }],
  			'subtitle': ['1.125rem', { lineHeight: '1.5rem', fontWeight: '500' }],
  			'body': ['0.9375rem', { lineHeight: '1.5rem', fontWeight: '400' }],
  			'caption': ['0.8125rem', { lineHeight: '1.25rem', fontWeight: '400' }],
  			'micro': ['0.6875rem', { lineHeight: '1rem', fontWeight: '500' }],
  		},
  		// `border` is a hairline: half a point on a high-density screen (DS20).
  		// `border-1` is a whole point, for a border the spec sizes in points
  		// (a Decision card's 1 pt edge).
  		borderWidth: { DEFAULT: 'var(--hairline-width)', '1': '1px' },
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down var(--astrid-motion-spring-duration) ease-out',
  			'accordion-up': 'accordion-up var(--astrid-motion-spring-duration) ease-out'
  		}
  	}
  },
  plugins: [tailwindcssAnimate],
};
export default config;
