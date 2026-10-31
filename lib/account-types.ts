import type { LearningState, LearningTrack } from "@/lib/types";

export const MAX_ACCOUNT_STATE_BYTES = 8 * 1024 * 1024;
export const MAX_ACCOUNT_TRACKS = 100;

export interface AccountUser {
  id: string;
  name: string;
  email: string;
}

export interface AccountTrackSummary {
  id: string;
  revision: number;
  updatedAt: string;
  title: string;
  track: LearningTrack;
  moduleCount: number;
  completedModuleCount: number;
  profileName: string;
}

export interface AccountTrack {
  id: string;
  revision: number;
  updatedAt: string;
  state: LearningState;
}
