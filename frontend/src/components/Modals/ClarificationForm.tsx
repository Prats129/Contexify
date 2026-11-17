import { useState } from "react";
import {
  clarificationFromFields,
  percentTargets,
  PlanningError,
  type ClarificationFormProps,
} from "@contexify/assistant-core";

export function ClarificationForm({
  pending,
  busy,
  onSubmit,
}: ClarificationFormProps) {
  const [target, setTarget] = useState("");
  const [operation, setOperation] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("");
  const [error, setError] = useState("");
  function reset() {
    setError("");
  }
  function submit() {
    try {
      onSubmit(clarificationFromFields(target, operation, amount, unit), false);
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
    <fieldset
      disabled={busy}
      className="border border-(--border-subtle) rounded-lg p-3 my-3 space-y-2"
    >
      <legend>Clarify your command</legend>
      <p className="text-xs">
        Your choices replace the earlier request with one settings action. Other
        actions will not run. This question expires after one minute.
      </p>
      <label className="block">
        Target
        <select
          aria-label="Clarification target"
          value={target}
          onChange={(event) => {
            reset();
            setTarget(event.target.value);
          }}
        >
          <option value="">Choose target</option>
          {percentTargets.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {pending.previousTarget && (
        <button
          type="button"
          onClick={() => {
            reset();
            setTarget(pending.previousTarget!);
          }}
        >
          Use previous reviewed target
        </button>
      )}
      <label className="block">
        Change
        <select
          aria-label="Clarification operation"
          value={operation}
          onChange={(event) => {
            reset();
            setOperation(event.target.value);
            setUnit(event.target.value === "set" ? "percent" : "");
          }}
        >
          <option value="">Choose change</option>
          <option value="set">Set exact percentage</option>
          <option value="increase">Increase by</option>
          <option value="decrease">Decrease by</option>
        </select>
      </label>
      <label className="block">
        Amount
        <input
          aria-label="Clarification amount"
          inputMode="numeric"
          maxLength={3}
          value={amount}
          onChange={(event) => {
            reset();
            setAmount(event.target.value);
          }}
        />
      </label>
      {operation && operation !== "set" && (
        <label className="block">
          Units
          <select
            aria-label="Clarification units"
            value={unit}
            onChange={(event) => {
              reset();
              setUnit(event.target.value);
            }}
          >
            <option value="">Choose units</option>
            <option value="percentage_points">Percentage points</option>
            <option value="percent">Percent of current value</option>
          </select>
        </label>
      )}
      {operation && operation !== "set" && (
        <p className="text-xs">
          Relative values need a fresh reading on the Android device. You can
          choose an exact percentage here.
        </p>
      )}
      <button type="button" onClick={submit}>
        Review clarified command
      </button>
      {error && <p role="status">{error}</p>}
    </fieldset>
  );
}
