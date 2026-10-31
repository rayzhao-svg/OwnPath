export const MAX_WEEKLY_STUDY_HOURS = 40;
export const CURRICULUM_WEEKS = 12;
export const MIN_GENERATED_MODULE_MINUTES = 30;
export const MAX_MODULE_DURATION_MINUTES = MAX_WEEKLY_STUDY_HOURS * 60 * CURRICULUM_WEEKS;

export function curriculumMinuteBudget(weeklyHours: number): number {
  return weeklyHours * 60 * CURRICULUM_WEEKS;
}
