/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand palette sampled from the Bristol logo.
        navy: {
          DEFAULT: '#1a293c',
          dark: '#10202f',
          light: '#e8ebf0',
        },
        gold: {
          DEFAULT: '#a87a3d',
          dark: '#8a6330',
          light: '#f3ecdd',
        },
        cream: '#eeecdd',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
}
