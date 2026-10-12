/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Barlow', 'system-ui', 'sans-serif'], display: ['"Barlow Condensed"', 'Barlow', 'sans-serif'] },
      colors: {
        // Färgerna är hämtade ur logotypen: kolsvart text (#2d2a29), logotypens röda (#b02820) och den ljusare röda i G-märket (#e5202a).
        brand: { 50: '#fdf3f2', 100: '#fbe2e0', 200: '#f6c0bc', 300: '#ee918a', 400: '#e65a52', 500: '#e5202a', 600: '#cc1f28', 700: '#b02820', 800: '#8a1f1a', 900: '#5c1512', 950: '#2d0a08' },
        ink: { 50: '#f7f6f6', 100: '#ebeae9', 200: '#d6d4d3', 300: '#b0adab', 400: '#85817f', 500: '#5f5b59', 600: '#474341', 700: '#383534', 800: '#2d2a29', 900: '#1f1d1c', 950: '#131110' },
      },
      boxShadow: { card: '0 1px 2px rgba(19,17,16,.06), 0 10px 30px rgba(19,17,16,.08)' },
    },
  },
  plugins: [],
};
