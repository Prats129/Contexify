import React from "react";
import { LuCheck } from "react-icons/lu";

interface PasswordChecks {
  minLength: boolean;
  hasLower: boolean;
  hasUpper: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
  notIdentity: boolean;
}

export interface PasswordStrengthResult {
  score: number;
  label: "Weak" | "Fair" | "Good" | "Strong";
  color: string;
  checks: PasswordChecks;
  isValid: boolean;
  feedback: string | null;
}

export function checkPasswordStrength(
  password: string,
  userContext?: { username?: string; email?: string; displayName?: string },
): PasswordStrengthResult {
  if (!password) {
    return {
      score: 0,
      label: "Weak",
      color: "#EF4444",
      checks: {
        minLength: false,
        hasLower: false,
        hasUpper: false,
        hasNumber: false,
        hasSpecial: false,
        notIdentity: true,
      },
      isValid: false,
      feedback: "Password is required.",
    };
  }

  const minLength = password.length >= 8;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{}|;:,.<>?~`'"/\\]/.test(password);

  let notIdentity = true;
  const lowered = password.toLowerCase();
  if (userContext) {
    const { username, email, displayName } = userContext;
    if (
      username &&
      username.trim().length >= 3 &&
      lowered.includes(username.trim().toLowerCase())
    ) {
      notIdentity = false;
    }
    if (email && email.includes("@")) {
      const prefix = email.split("@")[0].trim().toLowerCase();
      if (prefix.length >= 3 && lowered.includes(prefix)) {
        notIdentity = false;
      }
    }
    if (displayName && displayName.trim().length >= 3) {
      for (const part of displayName.trim().toLowerCase().split(/\s+/)) {
        if (part.length >= 3 && lowered.includes(part)) {
          notIdentity = false;
          break;
        }
      }
    }
  }

  let score = 0;
  if (minLength) score++;
  if (hasLower && hasUpper) score++;
  if (hasNumber && hasSpecial) score++;
  if (score === 3 && password.length >= 10 && notIdentity) score++;

  let label: "Weak" | "Fair" | "Good" | "Strong" = "Weak";
  let color = "#EF4444";
  if (score === 2) {
    label = "Fair";
    color = "#F59E0B";
  } else if (score === 3) {
    label = "Good";
    color = "#3B82F6";
  } else if (score >= 4) {
    label = "Strong";
    color = "#10B981";
  }

  let feedback: string | null = null;
  if (!minLength) {
    feedback = "Password must be at least 8 characters long.";
  } else if (!hasLower || !hasUpper) {
    feedback = "Password must contain both uppercase and lowercase letters.";
  } else if (!hasNumber) {
    feedback = "Password must contain at least one number.";
  } else if (!hasSpecial) {
    feedback = "Password must contain at least one special symbol (!@#$%...).";
  } else if (!notIdentity) {
    feedback = "Password cannot contain your name, username, or email.";
  }

  const isValid =
    minLength && hasLower && hasUpper && hasNumber && hasSpecial && notIdentity;

  return {
    score,
    label,
    color,
    checks: {
      minLength,
      hasLower,
      hasUpper,
      hasNumber,
      hasSpecial,
      notIdentity,
    },
    isValid,
    feedback,
  };
}

export const PasswordStrengthMeter: React.FC<{
  result: PasswordStrengthResult;
  showDetails?: boolean;
}> = ({ result, showDetails = true }) => {
  if (!result) return null;

  return (
    <div className="flex flex-col gap-1.5 mt-1 text-left">
      {/* 4-bar strength indicator */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex gap-1 h-1.5">
          {[1, 2, 3, 4].map((step) => (
            <div
              key={step}
              className="flex-1 rounded-full transition-all duration-300"
              style={{
                backgroundColor:
                  result.score >= step
                    ? result.color
                    : "var(--border-subtle, rgba(255,255,255,0.12))",
              }}
            />
          ))}
        </div>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
          style={{ color: result.color, backgroundColor: `${result.color}15` }}
        >
          {result.label}
        </span>
      </div>

      {showDetails && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10.5px] pt-1">
          <div
            className={`flex items-center gap-1 ${result.checks.minLength ? "text-emerald-500 font-medium" : "text-(--text-muted)"}`}
          >
            <LuCheck
              size={11}
              className={result.checks.minLength ? "opacity-100" : "opacity-30"}
            />
            <span>8+ characters</span>
          </div>
          <div
            className={`flex items-center gap-1 ${result.checks.hasLower && result.checks.hasUpper ? "text-emerald-500 font-medium" : "text-(--text-muted)"}`}
          >
            <LuCheck
              size={11}
              className={
                result.checks.hasLower && result.checks.hasUpper
                  ? "opacity-100"
                  : "opacity-30"
              }
            />
            <span>Upper & lowercase</span>
          </div>
          <div
            className={`flex items-center gap-1 ${result.checks.hasNumber ? "text-emerald-500 font-medium" : "text-(--text-muted)"}`}
          >
            <LuCheck
              size={11}
              className={result.checks.hasNumber ? "opacity-100" : "opacity-30"}
            />
            <span>At least 1 number</span>
          </div>
          <div
            className={`flex items-center gap-1 ${result.checks.hasSpecial ? "text-emerald-500 font-medium" : "text-(--text-muted)"}`}
          >
            <LuCheck
              size={11}
              className={
                result.checks.hasSpecial ? "opacity-100" : "opacity-30"
              }
            />
            <span>At least 1 symbol</span>
          </div>
        </div>
      )}

      {result.feedback && (
        <p className="text-[10.5px] text-amber-500/95 font-medium leading-tight">
          {result.feedback}
        </p>
      )}
    </div>
  );
};
