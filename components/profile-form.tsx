"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ResumeReview, ResumeSuggestion, ResumeUpload } from "@/components/resume-upload";
import { useLearning } from "@/lib/learning-context";
import { requestPlanResponse } from "@/lib/api-client";
import { inferLearningTrack } from "@/lib/learning-track";
import type { LearnerProfile } from "@/lib/types";
import type { ResumeResult } from "@/lib/resume";

function ProfileFields() {
  const { state, setPlan } = useLearning();
  const router = useRouter();
  const [hours, setHours] = useState(state.profile?.availableStudyTime || 5);
  const [details, setDetails] = useState({
    background: state.profile?.background || "",
    experience: state.profile?.experience || "",
    skills: state.profile?.skills.join(", ") || "",
  });
  const [resume, setResume] = useState<ResumeResult | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeReviewed, setResumeReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const requestGeneration = useRef(0);

  useEffect(() => () => { requestGeneration.current += 1; }, []);

  function acceptResume(result: ResumeResult) {
    setResume(result);
    setResumeReviewed(false);
    // Resolve against the latest values, including edits made during extraction.
    setDetails((current) => ({
      background: current.background.trim() ? current.background : result.profile.background,
      experience: current.experience.trim() ? current.experience : result.profile.experience,
      skills: current.skills.trim() ? current.skills : result.profile.skills.join(", "),
    }));
    setError(null);
  }

  function editDetail(field: keyof typeof details, value: string) {
    setDetails((current) => ({ ...current, [field]: value }));
    setResumeReviewed(false);
  }

  function suggestion(field: keyof typeof details, label: string) {
    if (!resume) return null;
    const value = field === "skills" ? resume.profile.skills.join(", ") : resume.profile[field];
    return <ResumeSuggestion label={label} value={value} disabled={busy} onReplace={() => editDetail(field, value)} />;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    if (resumeBusy || (resume && !resumeReviewed)) {
      setError(resumeBusy
        ? "Wait for resume processing to finish, or cancel it to continue manually."
        : "Review the resume information in your profile and confirm before creating your path.");
      return;
    }
    const fields = new FormData(event.currentTarget);
    const goals = String(fields.get("goals") || "").trim();
    const selectedTrack = String(fields.get("track") || "auto");
    const profile: LearnerProfile = {
      id: state.profile?.id || crypto.randomUUID(),
      name: String(fields.get("name") || "").trim(),
      background: details.background.trim(),
      experience: details.experience.trim(),
      skills: details.skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      goals,
      availableStudyTime: hours,
      track: selectedTrack === "data-science" || selectedTrack === "web-development" || selectedTrack === "product-design"
        ? selectedTrack : inferLearningTrack(goals, state.profile?.track),
    };
    if (!profile.name || !profile.background || !profile.goals) {
      setError(
        "Add your name, background, and goal so we can shape your path.",
      );
      return;
    }
    if (profile.skills.length > 30 || profile.skills.some((skill) => skill.length > 100)) {
      setError("Use up to 30 skills, with at most 100 characters per skill.");
      return;
    }
    pending.current = true;
    const generation = requestGeneration.current;
    setBusy(true);
    setError(null);
    try {
      const response = await requestPlanResponse(profile);
      if (generation !== requestGeneration.current) return;
      await setPlan(profile, response.plan, response.mode);
      router.push("/dashboard");
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Your path could not be created. Please try again.",
      );
      setBusy(false);
    } finally {
      if (generation === requestGeneration.current) pending.current = false;
    }
  }

  return (
    <div className="onboarding-layout">
      <div className="profile-main">
        <div className="page-intro">
          <span className="eyebrow">LET’S MAKE THIS PERSONAL</span>
          <h1>
            You’re not starting
            <br />
            from zero.
          </h1>
          <p>
            Your experiences count. Tell us a little about them,
            <br className="desktop-break" /> and we’ll help connect the dots.
          </p>
        </div>
        <form className="profile-form" onSubmit={submit}>
          <ResumeUpload disabled={busy} onExtracted={acceptResume} onBusyChange={setResumeBusy} />
          <fieldset disabled={busy}>
            <legend>
              <span>01</span>{" "}
              <label htmlFor="goals">What would you love to be able to do?</label>
            </legend>
            <textarea
              id="goals"
              name="goals"
              required
              maxLength={2000}
              rows={3}
              defaultValue={state.profile?.goals}
              placeholder="e.g. Use data to make better business decisions and move into an analyst role."
            />
            <label className="field-label" htmlFor="learning-track">Learning track</label>
            <select id="learning-track" name="track" className="learning-track-select" defaultValue={state.plan ? state.profile?.track : "auto"}>
              <option value="auto">Choose from my goal</option>
              <option value="data-science">Data science</option>
              <option value="web-development">Web development</option>
              <option value="product-design">Product design</option>
            </select>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>
              <span>02</span> What are you bringing with you?
            </legend>
            <div className="field-pair">
              <div>
                <label className="field-label" htmlFor="name">
                  What should we call you?
                </label>
                <input
                  id="name"
                  name="name"
                  required
                  maxLength={80}
                  autoComplete="given-name"
                  defaultValue={state.profile?.name}
                  placeholder="Your first name"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="background">
                  Academic background
                </label>
                <textarea
                  id="background"
                  name="background"
                  required
                  maxLength={2000}
                  rows={3}
                  value={details.background}
                  onChange={(event) => editDetail("background", event.target.value)}
                  placeholder="e.g. Bachelor’s in business"
                />
                {suggestion("background", "academic background")}
              </div>
            </div>
            <label className="field-label" htmlFor="experience">
              Work and life experience <span>(optional)</span>
            </label>
            <textarea
              id="experience"
              name="experience"
              maxLength={2000}
              rows={3}
              value={details.experience}
              onChange={(event) => editDetail("experience", event.target.value)}
              placeholder="A role, a project, or something you’ve taught yourself. It all counts."
            />
            {suggestion("experience", "experience")}
            <label className="field-label" htmlFor="skills">
              Skills you already have <span>(optional)</span>
            </label>
            <input
              id="skills"
              name="skills"
              maxLength={1000}
              value={details.skills}
              onChange={(event) => editDetail("skills", event.target.value)}
              placeholder="e.g. Excel, Python, project management"
              aria-describedby="skills-help"
            />
            <small id="skills-help" className="field-hint">
              Separate skills with commas. We’ll use these to set your starting
              point.
            </small>
            {suggestion("skills", "skills")}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>
              <span>03</span> Make room for your real life.
            </legend>
            <div className="study-time-label">
              <label htmlFor="study-time">
                How much time can you give each week?
              </label>
              <strong>
                {hours} <span>hours / week</span>
              </strong>
            </div>
            <input
              id="study-time"
              className="time-range"
              type="range"
              min={1}
              max={40}
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
            />
            <div className="range-labels">
              <span>1 hour · little by little</span>
              <span>40 hours · all in</span>
            </div>
          </fieldset>
          {resume && <ResumeReview reviewed={resumeReviewed} disabled={busy || resumeBusy} onChange={setResumeReviewed} />}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="profile-submit">
            <div>
              <Icon name="lock" size={14} />
              <span>Each learning path keeps its own lessons and progress.</span>
            </div>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || resumeBusy || (!!resume && !resumeReviewed)}
            >
              {busy
                ? "Mapping your next steps…"
                : state.plan
                  ? "Create my updated path"
                  : "Create my learning path"}
              {!busy && <Icon name="arrow-right" size={18} />}
            </button>
          </div>
          {state.plan && (
            <p className="field-hint">
              Creating a new path keeps your other saved paths and their progress.
            </p>
          )}
        </form>
      </div>
      <aside className="profile-aside">
        <span className="profile-aside-icon">
          <Icon name="leaf" size={30} />
        </span>
        <h2>
          A path that
          <br />
          starts with you.
        </h2>
        <p>
          No two people start in the same place. Your learning shouldn’t either.
        </p>
        <ul>
          <li>
            <Icon name="check" size={16} /> Build on what you know
          </li>
          <li>
            <Icon name="check" size={16} /> Focus on what matters next
          </li>
          <li>
            <Icon name="check" size={16} /> Fit learning around your life
          </li>
        </ul>
        <div className="aside-divider" />
        <span className="eyebrow">GOOD TO KNOW</span>
        <p className="aside-small">
          Your goal shapes a path around your background and study time.
          Sign in to save all your learning paths and progress to your account.
        </p>
      </aside>
    </div>
  );
}

export function ProfileForm() {
  const { ready } = useLearning();
  if (!ready)
    return (
      <div className="loading-state" role="status">
        Getting your space ready…
      </div>
    );
  return <ProfileFields />;
}
