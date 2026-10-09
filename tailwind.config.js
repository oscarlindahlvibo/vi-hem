/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        vihem: {
          navy: 'rgb(var(--vihem-navy-rgb) / <alpha-value>)',
          blue: 'rgb(var(--vihem-accent-rgb) / <alpha-value>)',
          canvas: 'rgb(var(--vihem-canvas-rgb) / <alpha-value>)',
          success: 'rgb(var(--vihem-success-rgb) / <alpha-value>)',
          danger: 'rgb(var(--vihem-danger-rgb) / <alpha-value>)',
          ink: 'rgb(var(--vihem-ink-rgb) / <alpha-value>)',
          muted: 'rgb(var(--vihem-muted-rgb) / <alpha-value>)',
        },
      },
      borderRadius: { card: 'var(--vihem-radius-card)', sheet: 'var(--vihem-radius-sheet)' },
      boxShadow: {
        card: 'var(--vihem-shadow-card)',
        float: 'var(--vihem-shadow-float)',
        sheet: '0 -12px 40px rgba(20, 33, 61, 0.2)',
      },
      keyframes: {
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'toast-in': { from: { opacity: '0', transform: 'translateY(12px) scale(0.98)' }, to: { opacity: '1', transform: 'translateY(0) scale(1)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'sheet-up': 'sheet-up 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-in': 'fade-in 0.2s ease-out',
        'toast-in': 'toast-in 0.22s ease-out',
      },
    },
  },
  plugins: [],
};
