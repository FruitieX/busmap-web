/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // HSL transport colors
        hsl: {
          blue: '#007ac9', // Buses
          green: '#00985f', // Trams
          orange: '#ff6319', // Metro
          purple: '#8c4799', // Trains
          cyan: '#00b9e4', // Ferries
          gray: '#999999', // U-line buses
        },
        // App colors
        primary: {
          50: '#e6f3fa',
          100: '#cce7f5',
          200: '#99cfeb',
          300: '#66b7e1',
          400: '#339fd7',
          500: '#007ac9',
          600: '#0062a1',
          700: '#004979',
          800: '#003150',
          900: '#001828',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        'sheet': '0 -4px 20px -2px rgba(0, 0, 0, 0.1)',
        'float': '0 4px 12px rgba(0, 0, 0, 0.15)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
