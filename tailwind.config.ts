import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

import { shadcnColors } from "./lib/design/tailwind-theme";

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
  		colors: {
  			...shadcnColors,
  		},
  		fontSize: {
  			'display': ['2rem', { lineHeight: '2.5rem', letterSpacing: '-0.01em', fontWeight: '600' }],
  			'title': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.01em', fontWeight: '600' }],
  			'subtitle': ['1.125rem', { lineHeight: '1.5rem', fontWeight: '500' }],
  			'body': ['0.9375rem', { lineHeight: '1.5rem', fontWeight: '400' }],
  			'caption': ['0.8125rem', { lineHeight: '1.25rem', fontWeight: '400' }],
  			'micro': ['0.6875rem', { lineHeight: '1rem', fontWeight: '500' }],
  		},
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
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [tailwindcssAnimate],
};
export default config;
