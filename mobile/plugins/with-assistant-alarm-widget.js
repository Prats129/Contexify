const fs = require("node:fs");
const path = require("node:path");
const { IOSConfig } = require("expo/config-plugins");
const targetName = "ContexifyScheduleWidget";
const marker = "<!-- Contexify owned schedule widget -->";
const unquote = (value) =>
  typeof value === "string" ? value.replace(/^"|"$/g, "") : value;

/** Native WidgetKit target, with no React/Expo, network credentials, app group or private text. */
module.exports = function configureAlarmWidget(mod, enabled) {
  const project = mod.modResults;
  const existing = Object.entries(project.pbxNativeTargetSection()).find(
    ([key, value]) =>
      !key.endsWith("_comment") &&
      value.name &&
      unquote(value.name) === targetName,
  );
  if (!enabled) {
    if (existing)
      throw new Error(
        "Use a clean, separate iOS project when leaving the Assistant scheduling test variant. Its widget must not be embedded in production.",
      );
    return mod;
  }
  const folder = path.join(mod.modRequest.platformProjectRoot, targetName);
  const plistPath = path.join(folder, "Info.plist");
  if (
    fs.existsSync(plistPath) &&
    !fs.readFileSync(plistPath, "utf8").includes(marker)
  )
    throw new Error(
      "Refusing to replace a manually maintained schedule widget.",
    );
  if (existing && !fs.existsSync(plistPath))
    throw new Error("The schedule widget target is not owned by this plugin.");
  const bundle = mod.ios?.bundleIdentifier;
  if (!bundle || !/^[A-Za-z0-9.-]+$/.test(bundle))
    throw new Error("A valid isolated iOS bundle identifier is required.");
  fs.mkdirSync(folder, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
${marker}
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
<key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
<key>CFBundleDisplayName</key><string>Contexify timer</string>
<key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>
<key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>
<key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string></dict>
</dict></plist>
`;
  const write = (file, text) => {
    const filename = path.join(folder, file);
    if (
      fs.existsSync(filename) &&
      fs.readFileSync(filename, "utf8") !== text &&
      file !== "Info.plist" &&
      !fs.readFileSync(filename, "utf8").startsWith("// Contexify shared") &&
      !fs
        .readFileSync(filename, "utf8")
        .startsWith("// Generated target source owned by Contexify")
    )
      throw new Error(
        "Refusing to replace a manually maintained widget source.",
      );
    if (!fs.existsSync(filename) || fs.readFileSync(filename, "utf8") !== text)
      fs.writeFileSync(filename, text);
  };
  write("Info.plist", plist);
  write(
    "ContexifyScheduleWidget.swift",
    fs.readFileSync(
      path.join(__dirname, "ios", "ContexifyScheduleWidget.swift"),
      "utf8",
    ),
  );
  write(
    "AppleAlarmMetadata.swift",
    "// Contexify shared alarm metadata.\n" +
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "modules",
          "assistant-device-security",
          "ios",
          "AppleAlarmMetadata.swift",
        ),
        "utf8",
      ),
  );
  let target;
  if (existing) target = { uuid: existing[0], pbxNativeTarget: existing[1] };
  else {
    target = project.addTarget(
      targetName,
      "app_extension",
      targetName,
      bundle + ".schedules",
    );
    project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase(
      [],
      "PBXResourcesBuildPhase",
      "Resources",
      target.uuid,
    );
    project.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      target.uuid,
    );
  }
  IOSConfig.XcodeUtils.ensureGroupRecursively(project, targetName);
  for (const file of [
    "ContexifyScheduleWidget.swift",
    "AppleAlarmMetadata.swift",
  ])
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: `${targetName}/${file}`,
      groupName: targetName,
      project,
      targetUuid: target.uuid,
    });
  const list =
    project.pbxXCConfigurationList()[
      target.pbxNativeTarget.buildConfigurationList
    ];
  const configs = project.pbxXCBuildConfigurationSection();
  const app =
    project.pbxXCConfigurationList()[
      project.getFirstTarget().firstTarget.buildConfigurationList
    ];
  for (const entry of list.buildConfigurations) {
    const config = configs[entry.value];
    const appConfig = app.buildConfigurations
      .map((item) => configs[item.value])
      .find((item) => item.name === config.name);
    Object.assign(config.buildSettings, {
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundle}.schedules"`,
      SWIFT_VERSION: "5.9",
      IPHONEOS_DEPLOYMENT_TARGET: "26.0",
      TARGETED_DEVICE_FAMILY: '"1,2"',
      APPLICATION_EXTENSION_API_ONLY: "YES",
      SKIP_INSTALL: "YES",
      GENERATE_INFOPLIST_FILE: "NO",
      INFOPLIST_FILE: `"${targetName}/Info.plist"`,
      CODE_SIGN_STYLE: "Automatic",
      MARKETING_VERSION: `"${mod.version || "1.0.0"}"`,
      CURRENT_PROJECT_VERSION: `"${mod.ios?.buildNumber || "1"}"`,
      ...(appConfig?.buildSettings.DEVELOPMENT_TEAM
        ? { DEVELOPMENT_TEAM: appConfig.buildSettings.DEVELOPMENT_TEAM }
        : {}),
    });
  }
  return mod;
};
