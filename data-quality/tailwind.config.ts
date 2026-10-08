import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#f2f5f8",
          100: "#e2e9f0",
          200: "#c5d3e0",
          300: "#9bb3c8",
          400: "#6d8da8",
          500: "#4a6d8c",
          600: "#1a3352",
          700: "#152a44",
          800: "#112238",
          900: "#0c1a2e",
        },
        accent: {
          300: "#d4bc94",
          400: "#c4a35a",
          500: "#b8956a",
          600: "#9a7d52",
        },
        exec: {
          success: "#3d6b5a",
          danger: "#8b4545",
          warning: "#9a7209",
          info: "#4a6d8c",
        },
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(18 26 40 / 0.04), 0 1px 3px 0 rgb(18 26 40 / 0.06)",
        elevated: "0 8px 24px -4px rgb(18 26 40 / 0.1), 0 2px 6px -2px rgb(18 26 40 / 0.05)",
      },
    },
  },
  plugins: [],
};

export default config;
