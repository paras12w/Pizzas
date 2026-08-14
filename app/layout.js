import "./globals.css";
import Nav from "./components/Nav";

export const metadata = {
  title: "Pizzas Sheckles — Live Trade Board",
  description:
    "Pizza money, ranked live: the top buy and sell calls from Reddit, Yahoo Finance, and Wall Street analyst ratings, traded automatically by two paper-trading bots.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="board-bg min-h-screen">
        <Nav />
        {children}
      </body>
    </html>
  );
}
