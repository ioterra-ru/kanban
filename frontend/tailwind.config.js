/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    /* ~2/3 of Tailwind defaults: visibly tighter corners across the UI */
    borderRadius: {
      none: "0px",
      sm: "0.083333rem",
      DEFAULT: "0.166667rem",
      md: "0.25rem",
      lg: "0.333333rem",
      xl: "0.5rem",
      "2xl": "0.666667rem",
      "3xl": "1rem",
      full: "9999px",
    },
    extend: {},
  },
  plugins: [],
}

