import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#070b14",
          900: "#0b1220",
          850: "#0f1729",
          800: "#121f35",
        },
        cream: {
          50: "#fffdf8",
          100: "#f6f0e3",
          200: "#e8dfc8",
        },
        gold: {
          200: "#f0dfa8",
          300: "#e3c565",
          400: "#d4af37",
        },
      },
      fontFamily: {
        sans: ["var(--font-dm)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "serif"],
      },
      boxShadow: {
        soft: "0 18px 60px rgba(7, 11, 20, 0.12)",
      },
    },
  },
  plugins: [],
} satisfies Config;
