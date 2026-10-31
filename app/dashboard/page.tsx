import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { CurriculumView } from "@/components/curriculum-view";
import { TrackSwitcher } from "@/components/track-switcher";

export const metadata: Metadata = { title: "Your learning path" };
export default function DashboardPage() {
  return (
    <AppShell
      active="dashboard"
      eyebrow="Your next chapter"
      title="My learning path"
    >
      <TrackSwitcher />
      <CurriculumView />
    </AppShell>
  );
}
