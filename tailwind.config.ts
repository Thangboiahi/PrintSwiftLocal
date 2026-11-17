import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ps: {
          bg: 'var(--ps-bg)',
          surface: 'var(--ps-surface)',
          'surface-alt': 'var(--ps-surface-alt)',
          border: 'var(--ps-border)',
          text: 'var(--ps-text)',
          'text-muted': 'var(--ps-text-muted)',
          accent: 'var(--ps-accent)',
          'accent-fg': 'var(--ps-accent-fg)',
          'accent-soft': 'var(--ps-accent-soft)',
          ring: 'var(--ps-ring)',
        },
      },
      boxShadow: {
        minimal: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        card: '0 1px 2px 0 rgba(15, 23, 42, 0.05)',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.92' },
          '50%': { transform: 'scale(1.06)', opacity: '1' },
        },
      },
      animation: {
        breathe: 'breathe 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
