# Local wake model

Engine: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), Apache-2.0.
React Native wrapper: [@siteed/sherpa-onnx.rn](https://github.com/deeeed/audiolab/tree/main/packages/sherpa-onnx.rn), MIT, pinned to 2.0.1.
Model: [English GigaSpeech KWS 3.3M, 2024-01-01](https://github.com/k2-fsa/sherpa-onnx/releases/tag/kws-models), standard archive (not the withdrawn mobile encoder). The upstream model README and Apache license attribution accompany the generated assets. Model licensing is documented in [the comparison](../../../docs/assistant/wake-library-comparison.md).

`scripts/assistant_wake_model.py` verifies the pinned archive and individual files before preparing build-time assets. No runtime download or API key is used. Keyword aliases are encoded with this model's BPE vocabulary. The compatibility trial's `Hello world` control is deliberately excluded from the assistant.

This Android foreground integration is not public-distribution approval, an always-on service or a voice identity check. iOS keeps its existing speech/Siri paths; the Sherpa Apple dependency is excluded until its own verification.
