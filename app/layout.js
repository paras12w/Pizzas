import "./globals.css";
import Nav from "./components/Nav";

export const metadata = {
  title: "SIGNAL DESK — Live Trade Board",
  description: "Automatically ranked options trade signals from Reddit, Yahoo Finance, and Discord alerts.",
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
