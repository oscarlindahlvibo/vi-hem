/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
      },
      colors: {
        forest: {
          50: '#f3f7f4',
          100: '#e3ebe5',
          200: '#c7d7cc',
          300: '#9fb8a8',
          400: '#729682',
          500: '#527a63',
          600: '#3f614e',
          700: '#334e3f',
          800: '#2a3f34',
          900: '#1a3a2e',
          950: '#0f261c',
        },
        sand: {
          50: '#fbf9f5',
          100: '#f5f0e8',
          200: '#ebe1d0',
          300: '#ddcab0',
          400: '#c9ad88',
          500: '#bd9a6e',
          600: '#a8855c',
          700: '#8a6a4b',
          800: '#6f5640',
          900: '#5a4634',
        },
        accent: {
          50: '#fef7ee',
          100: '#fdedd6',
          200: '#fad7ac',
          300: '#f6ba77',
          400: '#f19340',
          500: '#ee7a1f',
          600: '#e05e15',
          700: '#bb4615',
          800: '#963918',
          900: '#7a3115',
        },
        success: {
          500: '#3a8a5a',
          600: '#2f7349',
        },
        warning: {
          500: '#e0a020',
          600: '#c9881a',
        },
        error: {
          500: '#d05050',
          600: '#b54545',
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.6s ease-out',
        'fade-up': 'fadeUp 0.6s ease-out',
        'slide-in': 'slideIn 0.4s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
};
