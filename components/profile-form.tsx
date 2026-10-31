"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { useLearning } from "@/lib/learning-context";
import { requestPlanResponse } from "@/lib/api-client";
import type { LearnerProfile, LearningTrack } from "@/lib/types";

const tracks: {
  id: LearningTrack;
  title: string;
  detail: string;
  icon: "layers" | "book" | "sparkles";
}[] = [
  {
    id: "data-science",
    title: "Data science",
    detail: "Find the story in the numbers",
    icon: "layers",
  },
  {
    id: "web-development",
    title: "Web development",
    detail: "Bring your ideas to the browser",
    icon: "book",
  },
  {
    id: "product-design",
    title: "Product design",
    detail: "Create things people love to use",
    icon: "sparkles",
  },
];

function ProfileFields() {
  const { state, setPlan } = useLearning();
  const router = useRouter();
  const [track, setTrack] = useState<LearningTrack>(
    state.profile?.track || "data-science",
  );
  const [hours, setHours] = useState(state.profile?.availableStudyTime || 5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const requestGeneration = useRef(0);

  useEffect(() => () => { requestGeneration.current += 1; }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const fields = new FormData(event.currentTarget);
    const profile: LearnerProfile = {
      id: state.profile?.id || crypto.randomUUID(),
      name: String(fields.get("name") || "").trim(),
      background: String(fields.get("background") || "").trim(),
      experience: String(fields.get("experience") || "").trim(),
      skills: String(fields.get("skills") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      goals: String(fields.get("goals") || "").trim(),
      availableStudyTime: hours,
      track,
    };
    if (!profile.name || !profile.background || !profile.goals) {
      setError(
        "Add your name, background, and goal so we can shape your path.",
      );
      return;
    }
    pending.current = true;
    const generation = requestGeneration.current;
    setBusy(true);
    setError(null);
    try {
      const response = await requestPlanResponse(profile);
      if (generation !== requestGeneration.current) return;
      setPlan(profile, response.plan, response.mode);
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
          <fieldset>
            <legend>
              <span>01</span> Where do you want to go?
            </legend>
            <p className="field-hint">
              Pick a direction. Your goal will make it more specific.
            </p>
            <div className="track-options">
              {tracks.map((item) => (
                <label
                  key={item.id}
                  className={`track-option ${track === item.id ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="track"
                    value={item.id}
                    checked={track === item.id}
                    onChange={() => setTrack(item.id)}
                  />
                  <Icon name={item.icon} size={22} />
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                  <span className="track-check">
                    {track === item.id && <Icon name="check" size={11} />}
                  </span>
                </label>
              ))}
            </div>
            <label className="field-label" htmlFor="goals">
              What would you love to be able to do?
            </label>
            <textarea
              id="goals"
              name="goals"
              required
              maxLength={2000}
              rows={3}
              defaultValue={state.profile?.goals}
              placeholder="e.g. Use data to make better business decisions and move into an analyst role."
            />
          </fieldset>
          <fieldset>
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
                <input
                  id="background"
                  name="background"
                  required
                  maxLength={2000}
                  defaultValue={state.profile?.background}
                  placeholder="e.g. Bachelor’s in business"
                />
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
              defaultValue={state.profile?.experience}
              placeholder="A role, a project, or something you’ve taught yourself. It all counts."
            />
            <label className="field-label" htmlFor="skills">
              Skills you already have <span>(optional)</span>
            </label>
            <input
              id="skills"
              name="skills"
              maxLength={1000}
              defaultValue={state.profile?.skills.join(", ")}
              placeholder="e.g. Excel, Python, project management"
              aria-describedby="skills-help"
            />
            <small id="skills-help" className="field-hint">
              Separate skills with commas. We’ll use these to set your starting
              point.
            </small>
          </fieldset>
          <fieldset>
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
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="profile-submit">
            <div>
              <Icon name="lock" size={14} />
              <span>Saved in this browser. No account needed.</span>
            </div>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy}
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
              Creating a new path replaces the current curriculum and resets its
              progress in this browser.
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
          Explore three subjects with a path shaped by your background, goals,
          and study time. Your lessons and progress stay in this browser.
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
