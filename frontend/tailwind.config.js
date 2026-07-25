/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f0d1a',
        'ink-2': '#161325',
        'ink-card': '#1b1730',
        brand: {
          teal: '#14b8a6',
          indigo: '#4f46e5',
          'teal-1': '#0d9488',
          'teal-2': '#14b8a6',
          'teal-3': '#2dd4bf',
          'indigo-4': '#4f46e5',
          'coral-2': '#fb923c',
          'coral-3': '#fdba74',
        },
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        heroGradient: {
          '0%': { backgroundPosition: '0% 50%' },
          '25%': { backgroundPosition: '50% 100%' },
          '50%': { backgroundPosition: '100% 50%' },
          '75%': { backgroundPosition: '50% 0%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(20px) scale(0.95)' },
          '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
        },
      },
      animation: {
        heroGradient: 'heroGradient 18s ease infinite',
        fadeUp: 'fadeUp 0.5s ease forwards',
        slideIn: 'slideIn 0.3s ease-out',
      },
    },
  },
  plugins: [],
};
