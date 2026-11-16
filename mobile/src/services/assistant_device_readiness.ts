import { Platform } from "react-native";
import { deviceSecurity } from "../../modules/assistant-device-security";

type Availability = "available" | "unavailable";
type ApplicationAvailability = Availability | "no_reviewed_handler";
export interface DeviceControlReadiness {
  protocol_version: 1;
  platform: "android";
  execution_enabled: false;
  context:
    | "foreground_unlocked"
    | "foreground_required"
    | "device_locked"
    | "unavailable";
  media_volume: Availability | "fixed_volume";
  app_brightness: Availability;
  applications: {
    spotify: ApplicationAvailability;
    clock: ApplicationAvailability;
  };
}

const unavailable = () =>
  new Error(
    "Android support checks are unavailable. A compatible native build is required.",
  );

function fields(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw unavailable();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    Object.values(descriptors).some((item) => !("value" in item))
  )
    throw unavailable();
  return value as Record<string, unknown>;
}

function validate(value: unknown): DeviceControlReadiness {
  const report = fields(value, [
    "protocol_version",
    "platform",
    "execution_enabled",
    "context",
    "media_volume",
    "app_brightness",
    "applications",
  ]);
  const applications = fields(report.applications, ["spotify", "clock"]);
  if (
    report.protocol_version !== 1 ||
    report.platform !== "android" ||
    report.execution_enabled !== false ||
    ![
      "foreground_unlocked",
      "foreground_required",
      "device_locked",
      "unavailable",
    ].includes(report.context as string) ||
    !["available", "fixed_volume", "unavailable"].includes(
      report.media_volume as string,
    ) ||
    !["available", "unavailable"].includes(report.app_brightness as string) ||
    Object.values(applications).some(
      (item) =>
        !["available", "no_reviewed_handler", "unavailable"].includes(
          item as string,
        ),
    )
  )
    throw unavailable();
  if (
    report.context !== "foreground_unlocked" &&
    (report.media_volume !== "unavailable" ||
      report.app_brightness !== "unavailable" ||
      Object.values(applications).some((item) => item !== "unavailable"))
  )
    throw unavailable();
  // A defensive copy prevents bridge-side mutation after validation.
  return {
    ...report,
    applications: { ...applications },
  } as DeviceControlReadiness;
}

/** Explicit user gesture only. Never persist, upload, poll or interpret these hints as authority. */
export async function readDeviceControlReadiness(
  signal: AbortSignal,
): Promise<DeviceControlReadiness> {
  if (signal.aborted || Platform.OS !== "android") throw unavailable();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  try {
    const native = deviceSecurity();
    if (typeof native.deviceControlReadiness !== "function")
      throw unavailable();
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(unavailable());
      signal.addEventListener("abort", abort, { once: true });
      timeout = setTimeout(abort, 3000);
    });
    const report = await Promise.race([
      native.deviceControlReadiness(),
      interrupted,
    ]);
    if (signal.aborted) throw unavailable();
    return validate(report);
  } catch {
    // Never expose platform exception details or data from a malformed bridge report.
    throw unavailable();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function describeDeviceControlReadiness(
  report: DeviceControlReadiness,
  volumeControlsVisible = false,
): string {
  if (report.context === "foreground_required")
    return "Keep the app open to check Android support. Device actions remain disabled.";
  if (report.context === "device_locked")
    return "Unlock your phone to check Android support. Device actions remain disabled.";
  if (report.context !== "foreground_unlocked")
    return "Android support could not be checked. Device actions remain disabled.";
  const app = (value: ApplicationAvailability) =>
    value === "available"
      ? "reviewed launcher found"
      : value === "no_reviewed_handler"
        ? "no reviewed launcher found"
        : "could not be checked";
  return [
    `Media volume: ${report.media_volume === "available" ? "adjustable stream found" : report.media_volume === "fixed_volume" ? "fixed by this device" : "could not be checked"}.`,
    `App brightness: ${report.app_brightness === "available" ? "app window found" : "could not be checked"}.`,
    `Spotify: ${app(report.applications.spotify)}. Clock: ${app(report.applications.clock)}.`,
    volumeControlsVisible
      ? "These are support hints only. Volume changes require separate confirmation."
      : "These are support hints only. Device actions remain disabled.",
  ].join("\n");
}
