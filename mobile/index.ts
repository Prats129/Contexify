import { registerRootComponent } from "expo";

// The isolated verification APK never initializes chat, account storage or API services.
const App =
  process.env.EXPO_PUBLIC_ASSISTANT_NATIVE_TEST === "true"
    ? require("./src/testing/AssistantNativeVerificationApp").default
    : require("./App").default;

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
