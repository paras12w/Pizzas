import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0a0908",
        panel: "#121110",
        line: "#2a2622",
        amber: "#ffb347",
        amberDim: "#c98a35",
        amberFaint: "#5c4726",
        green: "#7ec97e",
        red: "#e85d5d",
        paper: "#e8e2d5",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
        display: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
