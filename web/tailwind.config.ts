import type { Config } from 'tailwindcss';

/** Neutres lleugerament tenyits i un sol color d'accent (verd blavós). */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          0: 'oklch(99% 0.004 220)',
          50: 'oklch(97.5% 0.005 220)',
          100: 'oklch(95% 0.006 220)',
          200: 'oklch(90% 0.008 220)',
          300: 'oklch(82% 0.010 220)',
          400: 'oklch(68% 0.012 220)',
          500: 'oklch(54% 0.014 220)',
          600: 'oklch(42% 0.016 220)',
          700: 'oklch(32% 0.018 220)',
          800: 'oklch(22% 0.018 220)',
          900: 'oklch(15% 0.016 220)',
        },
        brand: {
          50: 'oklch(97% 0.025 195)',
          100: 'oklch(93% 0.050 195)',
          200: 'oklch(86% 0.080 195)',
          300: 'oklch(76% 0.110 195)',
          400: 'oklch(64% 0.120 195)',
          500: 'oklch(52% 0.110 195)',
          600: 'oklch(45% 0.100 195)',
          700: 'oklch(38% 0.085 195)',
          800: 'oklch(30% 0.065 195)',
          900: 'oklch(22% 0.045 195)',
        },
        danger: 'oklch(56% 0.200 28)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;