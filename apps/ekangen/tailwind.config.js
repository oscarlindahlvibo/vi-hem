/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], serif: ['Fraunces', 'Georgia', 'serif'] },
      colors: {
        fjord: { 50: '#eef6f7', 100: '#d6e8eb', 200: '#aed2d8', 300: '#7ab4be', 400: '#4a909e', 500: '#2f7482', 600: '#265e6b', 700: '#214d58', 800: '#1d414a', 900: '#173941', 950: '#0b2228' },
        paper: { 50: '#fcfbf8', 100: '#f6f3ec', 200: '#ece6d8' },
        amber: { 400: '#f0b04a', 500: '#e69a2a', 600: '#c97f17' },
      },
      boxShadow: { card: '0 1px 2px rgba(11,34,40,.05), 0 8px 28px rgba(11,34,40,.07)' },
    },
  },
  plugins: [],
};
