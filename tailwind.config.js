/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bowlby One"', '"DM Sans"', 'sans-serif'],
        sans: ['"DM Sans"', 'ui-sans-serif', 'sans-serif'],
      },
      colors: {
        sunset: {
          indigo: '#1b1a8c',
          violet: '#4c1fb0',
          magenta: '#b01fb8',
          pink: '#ff2f8e',
          orange: '#ff6f3c',
          yellow: '#ffc83d',
        },
      },
    },
  },
  plugins: [],
}
