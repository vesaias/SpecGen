/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Muted-olive brand. Keep it warm-neutral to pair with `stone`.
        brand: {
          DEFAULT: '#6b705c',
          50: '#f5f5f0',
          100: '#e8e9dd',
          200: '#cfd1bb',
          300: '#b3b793',
          400: '#979d76',
          500: '#7d8362',
          600: '#6b705c', // base
          700: '#565b4a',
          800: '#42463a',
          900: '#2e3128',
        },
      },
    },
  },
  plugins: [],
};
