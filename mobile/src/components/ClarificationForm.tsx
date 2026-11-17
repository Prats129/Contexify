import React, { useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import {
  clarificationFromFields,
  percentTargets,
  PlanningError,
  type ClarificationFormProps,
} from "@contexify/assistant-core";
import type { AppTheme } from "../theme/colors";

export function ClarificationForm({
  pending,
  busy,
  onSubmit,
  theme,
}: ClarificationFormProps & { theme: AppTheme }) {
  const [target, setTarget] = useState("");
  const [operation, setOperation] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  function reset() {
    setConsent(false);
    setError("");
  }
  function choice(label: string, selected: boolean, change: () => void) {
    return (
      <TouchableOpacity
        key={label}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled: busy }}
        disabled={busy}
        onPress={() => {
          reset();
          change();
        }}
        style={{
          minHeight: 44,
          justifyContent: "center",
          padding: 8,
          borderWidth: 1,
          borderColor: theme.borderSubtle,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: theme.textMain }}>
          {selected ? "● " : "○ "}
          {label}
        </Text>
      </TouchableOpacity>
    );
  }
  function submit() {
    try {
      onSubmit(
        clarificationFromFields(target, operation, amount, unit),
        consent,
      );
      setConsent(false);
      setError("");
    } catch (error) {
      setError(
        error instanceof PlanningError
          ? error.message
          : "Choose a permitted exact percentage.",
      );
    }
  }
  return (
    <View
      style={{
        gap: 8,
        padding: 12,
        borderWidth: 1,
        borderRadius: 10,
        borderColor: theme.borderSubtle,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ color: theme.textMain, fontWeight: "600" }}
      >
        Clarify your command
      </Text>
      <Text style={{ color: theme.textMuted }}>
        Your choices replace the earlier request with one settings action. Other
        actions will not run. This question expires after one minute.
      </Text>
      {percentTargets.map(([value, label]) =>
        choice(label, target === value, () => setTarget(value)),
      )}
      {pending.previousTarget &&
        choice(
          "Use previous reviewed target",
          target === pending.previousTarget,
          () => setTarget(pending.previousTarget!),
        )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {[
          ["set", "Set exact percentage"],
          ["increase", "Increase by"],
          ["decrease", "Decrease by"],
        ].map(([value, label]) =>
          choice(label, operation === value, () => {
            setOperation(value);
            setUnit(value === "set" ? "percent" : "");
          }),
        )}
      </View>
      <TextInput
        accessibilityLabel="Clarification amount"
        keyboardType="number-pad"
        maxLength={3}
        value={amount}
        editable={!busy}
        onChangeText={(text) => {
          reset();
          setAmount(text);
        }}
        placeholder="Whole-number amount"
        placeholderTextColor={theme.textMuted}
        style={{
          minHeight: 44,
          color: theme.textMain,
          padding: 8,
          borderWidth: 1,
          borderColor: theme.borderSubtle,
        }}
      />
      {operation && operation !== "set" && (
        <View style={{ gap: 8 }}>
          {choice("Percentage points", unit === "percentage_points", () =>
            setUnit("percentage_points"),
          )}
          {choice("Percent of current value", unit === "percent", () =>
            setUnit("percent"),
          )}
          <TouchableOpacity
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent, disabled: busy }}
            disabled={busy}
            onPress={() => setConsent(!consent)}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: theme.textMain }}>
              {consent ? "☑" : "☐"} Allow one local media-volume reading for
              this change. The reading stays out of AI requests.
            </Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={{ color: theme.textMuted }}>
        The final target and result use the existing secure device-control
        backend.
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        disabled={busy}
        accessibilityState={{ disabled: busy }}
        onPress={submit}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text style={{ color: theme.textMain }}>Review clarified command</Text>
      </TouchableOpacity>
      {error && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: theme.textMain }}
        >
          {error}
        </Text>
      )}
    </View>
  );
}
