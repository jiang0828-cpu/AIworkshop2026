import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/pages/**/*.{js,ts,jsx,tsx,mdx}", "./src/components/**/*.{js,ts,jsx,tsx,mdx}", "./src/app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1f2933",
        mist: "#f6f7f5",
        sage: "#5e7867",
        line: "#e3e8e3",
      },
      boxShadow: { soft: "0 8px 30px rgba(31, 41, 51, .06)" },
    },
  },
  plugins: [],
};

export default config;
