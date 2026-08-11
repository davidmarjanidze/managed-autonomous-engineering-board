/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          black: "#000000",
          darkGray: "#121212",
          white: "#FFFFFF",
          lightGray: "#F5F5F7",
          green: {
            DEFAULT: "#00F59B",
            hover: "#00D485",
            muted: "#102A20",
          },
        },
      },
      boxShadow: {
        neon: "0 0 20px rgba(0,245,155,0.2)",
      },
      fontFamily: {
        body: ["Lato", "Roboto", "sans-serif"],
        brand: ["Cause", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};
