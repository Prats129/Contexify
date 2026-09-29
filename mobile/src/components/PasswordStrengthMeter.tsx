import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";

export interface PasswordChecks {
  minLength: boolean;
  hasLower: boolean;
  hasUpper: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
  notIdentity: boolean;
}

export interface PasswordStrengthResult {
  score: number; // 0 to 4
  label: "Weak" | "Fair" | "Good" | "Strong";
  color: string;
  checks: PasswordChecks;
  isValid: boolean;
  feedback: string | null;
}

export function checkPasswordStrength(
  password: string,
  userContext?: {
    username?: string;
    email?: string;
    displayName?: string;
  }
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
    if (username && username.trim().length >= 3 && lowered.includes(username.trim().toLowerCase())) {
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

  const isValid = minLength && hasLower && hasUpper && hasNumber && hasSpecial && notIdentity;

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

interface PasswordStrengthMeterProps {
  result: PasswordStrengthResult;
  theme: any;
  showChecklist?: boolean;
}

export const PasswordStrengthMeter: React.FC<PasswordStrengthMeterProps> = ({
  result,
  theme,
  showChecklist = true,
}) => {
  if (!result) return null;

  return (
    <View style={styles.container}>
      {/* 4-Segment Strength Bar */}
      <View style={styles.barRow}>
        <View style={styles.bars}>
          {[1, 2, 3, 4].map((step) => (
            <View
              key={step}
              style={[
                styles.segment,
                {
                  backgroundColor:
                    result.score >= step
                      ? result.color
                      : theme.borderSubtle || "rgba(255,255,255,0.1)",
                },
              ]}
            />
          ))}
        </View>
        <View style={[styles.badge, { backgroundColor: `${result.color}20` }]}>
          <Text style={[styles.badgeText, { color: result.color }]}>
            {result.label}
          </Text>
        </View>
      </View>

      {/* Criteria Checklist */}
      {showChecklist && (
        <View style={styles.checklist}>
          <View style={styles.checkRow}>
            <Feather
              name={result.checks.minLength ? "check-circle" : "circle"}
              size={11}
              color={result.checks.minLength ? "#10B981" : theme.textMuted}
            />
            <Text
              style={[
                styles.checkLabel,
                {
                  color: result.checks.minLength ? "#10B981" : theme.textMuted,
                  fontWeight: result.checks.minLength ? "600" : "400",
                },
              ]}
            >
              8+ characters
            </Text>
          </View>

          <View style={styles.checkRow}>
            <Feather
              name={
                result.checks.hasLower && result.checks.hasUpper
                  ? "check-circle"
                  : "circle"
              }
              size={11}
              color={
                result.checks.hasLower && result.checks.hasUpper
                  ? "#10B981"
                  : theme.textMuted
              }
            />
            <Text
              style={[
                styles.checkLabel,
                {
                  color:
                    result.checks.hasLower && result.checks.hasUpper
                      ? "#10B981"
                      : theme.textMuted,
                  fontWeight:
                    result.checks.hasLower && result.checks.hasUpper
                      ? "600"
                      : "400",
                },
              ]}
            >
              Upper & lower
            </Text>
          </View>

          <View style={styles.checkRow}>
            <Feather
              name={result.checks.hasNumber ? "check-circle" : "circle"}
              size={11}
              color={result.checks.hasNumber ? "#10B981" : theme.textMuted}
            />
            <Text
              style={[
                styles.checkLabel,
                {
                  color: result.checks.hasNumber ? "#10B981" : theme.textMuted,
                  fontWeight: result.checks.hasNumber ? "600" : "400",
                },
              ]}
            >
              Number (0-9)
            </Text>
          </View>

          <View style={styles.checkRow}>
            <Feather
              name={result.checks.hasSpecial ? "check-circle" : "circle"}
              size={11}
              color={result.checks.hasSpecial ? "#10B981" : theme.textMuted}
            />
            <Text
              style={[
                styles.checkLabel,
                {
                  color: result.checks.hasSpecial ? "#10B981" : theme.textMuted,
                  fontWeight: result.checks.hasSpecial ? "600" : "400",
                },
              ]}
            >
              Symbol (!@#)
            </Text>
          </View>
        </View>
      )}

      {/* Dynamic Feedback Message */}
      {result.feedback && (
        <Text style={[styles.feedbackText, { color: "#F59E0B" }]}>
          {result.feedback}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 6,
    marginBottom: 4,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bars: {
    flex: 1,
    flexDirection: "row",
    gap: 4,
    height: 4,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  checklist: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 6,
    rowGap: 4,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "50%",
    gap: 5,
  },
  checkLabel: {
    fontSize: 10.5,
  },
  feedbackText: {
    fontSize: 10.5,
    fontWeight: "500",
    marginTop: 4,
  },
});
