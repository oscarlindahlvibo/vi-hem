/** @type {import('tailwindcss').Config} */
export default {
  content: {relative:true,files:['./index.html', './src/**/*.{js,ts,jsx,tsx}']},
  theme: {
    extend: {
      colors: {
        // Neutral base — warm Scandinavian graphite / stone
        ink: {
          50: '#f6f6f5',
          100: '#ececea',
          200: '#d4d4d1',
          300: '#b0b0ab',
          400: '#86857e',
          500: '#6c6b64',
          600: '#56554f',
          700: '#454440',
          800: '#3a3936',
          900: '#2a2a28',
          950: '#1c1c1b',
        },
        // Single strong accent — Vibo signal green (energy, EV, go)
        signal: {
          50: '#ebfbee',
          100: '#d3f9d8',
          200: '#a9e8b6',
          300: '#71d28a',
          400: '#3eb863',
          500: '#1f9e49',
          600: '#138538',
          700: '#116a30',
          800: '#125328',
          900: '#114423',
          950: '#032712',
        },
        status: {
          available: '#1f9e49',
          charging: '#2563eb',
          occupied: '#d97706',
          reserved: '#7c3aed',
          faulted: '#dc2626',
          unknown: '#6c6b64',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Bricolage Grotesque"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      letterSpacing: {
        tightest: '-0.04em',
        tighter: '-0.03em',
        ultra: '-0.02em',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      boxShadow: {
        'raised': '0 1px 2px rgba(28,28,27,0.06), 0 8px 24px -12px rgba(28,28,27,0.18)',
        'lifted': '0 1px 2px rgba(28,28,27,0.08), 0 20px 48px -24px rgba(28,28,27,0.28)',
        'glow-signal': '0 0 0 1px rgba(31,158,73,0.18), 0 12px 32px -12px rgba(31,158,73,0.35)',
      },
      backgroundImage: {
        'grid-faint':
          'linear-gradient(to right, rgba(28,28,27,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(28,28,27,0.04) 1px, transparent 1px)',
        'grid-dark':
          'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in-out-expo': 'cubic-bezier(0.87, 0, 0.13, 1)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.8)', opacity: '0.7' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'marquee': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.7s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in': 'fade-in 0.7s ease both',
        'scale-in': 'scale-in 0.4s cubic-bezier(0.16,1,0.3,1) both',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.16,1,0.3,1) infinite',
        'shimmer': 'shimmer 1.8s linear infinite',
        'marquee': 'marquee 40s linear infinite',
      },
    },
  },
  plugins: [],
};
