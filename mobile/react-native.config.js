// Android wake is the only approved Sherpa integration. Keep existing Apple
// builds independent of its unverified CocoaPods binaries and install scripts.
module.exports = {
  dependencies: {
    "@siteed/sherpa-onnx.rn": { platforms: { ios: null } },
  },
};
