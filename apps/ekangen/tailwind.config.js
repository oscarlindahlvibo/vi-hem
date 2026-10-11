/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], serif: ['Fraunces', 'Georgia', 'serif'] },
      colors: {
        fjord: { 50: '#f5f7ef', 100: '#e8edda', 200: '#cfd8b6', 300: '#adbb8b', 400: '#8d9e5e', 500: '#788840', 600: '#61712f', 700: '#4a5830', 800: '#313a25', 900: '#262e1c', 950: '#161b10' },
        paper: { 50: '#fbf9f3', 100: '#f4f0e4', 200: '#e9e3d0' },
        amber: { 400: '#e0aa45', 500: '#cf9630', 600: '#b07c1f' },
      },
      boxShadow: { card: '0 1px 2px rgba(38,46,28,.05), 0 8px 28px rgba(38,46,28,.08)' },
    },
  },
  plugins: [],
};
