import type { Metadata } from "next";
import { AccountPanel } from "@/components/account-panel";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = { title: "Your account" };

export default function AccountPage() {
  return <AppShell active="account" eyebrow="A home for your progress" title="Your account"><AccountPanel /></AppShell>;
}
