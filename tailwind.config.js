/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        vihem: {
          navy: '#193B73',
          blue: '#2563EB',
          canvas: '#F3F6FB',
          success: '#0F9F76',
          danger: '#E5484D',
          ink: '#14213D',
          muted: '#6B7A99',
        },
      },
      borderRadius: { card: '1.125rem', sheet: '1.75rem' },
      boxShadow: {
        card: '0 1px 2px rgba(25, 59, 115, 0.04), 0 6px 20px rgba(25, 59, 115, 0.06)',
        float: '0 10px 30px rgba(25, 59, 115, 0.18), 0 2px 6px rgba(25, 59, 115, 0.08)',
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
