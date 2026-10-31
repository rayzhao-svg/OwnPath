import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ProfileForm } from "@/components/profile-form";

export const metadata: Metadata = { title: "Find your path" };

export default function OnboardingPage() {
  return (
    <AppShell
      active="onboarding"
      eyebrow="A path begins with a person"
      title="Your learner profile"
    >
      <ProfileForm />
    </AppShell>
  );
}
