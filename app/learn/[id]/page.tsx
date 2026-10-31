import { LessonExperience } from "@/components/lesson-experience";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LessonExperience key={id} moduleId={id} />;
}
