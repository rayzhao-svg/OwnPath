import type { Metadata } from "next";
import { LearningProvider } from "@/lib/learning-context";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "OwnPath — A learning path that's yours",
    template: "%s | OwnPath",
  },
  description:
    "Everything you need to learn. Nothing you don't. A personalized learning path built around your experience, your goals, and your time.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <LearningProvider>{children}</LearningProvider>
      </body>
    </html>
  );
}
