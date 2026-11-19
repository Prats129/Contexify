import ExpoModulesCore
import AVFoundation
import Speech
import UIKit

/** Main-queue session. No audio files, transcript logging, network or executor port. */
private final class LocalVoiceSession: NSObject, AVSpeechSynthesizerDelegate {
  var emit: ((String, [String: Any]) -> Void)?
  private var id: String?
  private var promise: Promise?
  private var engine: AVAudioEngine?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private let speech = AVSpeechSynthesizer()
  private var timeout: DispatchWorkItem?
  private var savedAudio: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
  private var audioActivated = false
  private var installedTap = false
  private var speaking = false
  private var utterance: AVSpeechUtterance?
  private var observers: [NSObjectProtocol] = []

  override init() {
    super.init()
    speech.delegate = self
    for name in [UIApplication.didEnterBackgroundNotification, UIApplication.protectedDataWillBecomeUnavailableNotification,
                 AVAudioSession.interruptionNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.cancel("ERR_VOICE_FOREGROUND")
      })
    }
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
      // Ignore category changes caused by our own setup; stop if an output device is removed.
      if let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
         AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable {
        self?.cancel("ERR_VOICE_FOCUS")
      }
    })
  }
  deinit { observers.forEach(NotificationCenter.default.removeObserver) }

  private func foreground() -> Bool {
    UIApplication.shared.applicationState == .active && UIApplication.shared.isProtectedDataAvailable
  }
  private func localRecognizer() -> SFSpeechRecognizer? {
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
          recognizer.supportsOnDeviceRecognition, recognizer.isAvailable else { return nil }
    return recognizer
  }
  private func voice() -> AVSpeechSynthesisVoice? {
    AVSpeechSynthesisVoice.speechVoices().first { $0.language == "en-US" }
  }
  private var enabled: Bool {
    Bundle.main.object(forInfoDictionaryKey: "ContexifyAssistantVoiceEnabled") as? Bool == true
  }
  func availability() -> [String: Any] {
    let configured = ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"].allSatisfy {
      guard let text = Bundle.main.object(forInfoDictionaryKey: $0) as? String else { return false }
      return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    let status = SFSpeechRecognizer.authorizationStatus()
    let permitted = status != .denied && status != .restricted
      && AVAudioSession.sharedInstance().recordPermission != .denied
    let available = enabled && configured && permitted && localRecognizer() != nil
    return ["recognition": available, "synthesis": enabled && voice() != nil,
      "message": available ? "On-device English speech can be requested. Microphone and speech permissions are required."
        : "On-device English speech is unavailable or permission was denied. Type your command or check iPhone Settings."]
  }
  private func begin(_ value: String, _ pending: Promise) -> Bool {
    guard enabled, id == nil, foreground(), !value.isEmpty, value.utf8.count <= 128 else {
      pending.reject("ERR_VOICE_FOREGROUND", "Local voice is unavailable."); return false
    }
    id = value
    promise = pending
    let deadline = DispatchWorkItem { [weak self] in self?.cancel("ERR_VOICE_TIMEOUT") }
    timeout = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: deadline)
    return true
  }
  private func activate(_ category: AVAudioSession.Category, _ mode: AVAudioSession.Mode) throws {
    let audio = AVAudioSession.sharedInstance()
    savedAudio = (audio.category, audio.mode, audio.categoryOptions)
    try audio.setCategory(category, mode: mode)
    try audio.setActive(true)
    audioActivated = true
  }
  private func finish(_ result: String?, _ error: String?) {
    let pending = promise
    // Invalidate callbacks before cancelling the recognizer or speech synthesizer.
    id = nil
    promise = nil
    timeout?.cancel()
    timeout = nil
    engine?.stop()
    if installedTap { engine?.inputNode.removeTap(onBus: 0) }
    installedTap = false
    request?.endAudio()
    task?.cancel()
    speech.stopSpeaking(at: .immediate)
    utterance = nil
    task = nil
    request = nil
    engine = nil
    speaking = false
    let audio = AVAudioSession.sharedInstance()
    if audioActivated { try? audio.setActive(false, options: .notifyOthersOnDeactivation) }
    audioActivated = false
    if let previous = savedAudio {
      try? audio.setCategory(previous.0, mode: previous.1, options: previous.2)
    }
    savedAudio = nil
    if let error { pending?.reject(error, "Local voice stopped or unavailable.") }
    else { pending?.resolve(result) }
  }
  func cancel(_ error: String = "ERR_VOICE_CANCELLED") { if id != nil { finish(nil, error) } }
  func cancel(_ value: String, requestId: String) { if id == requestId { cancel(value) } }

  func listen(_ value: String, consent: Bool, pending: Promise) {
    guard consent, availability()["recognition"] as? Bool == true else {
      pending.reject("ERR_VOICE_PERMISSION", "On-device speech or permission is unavailable."); return
    }
    guard begin(value, pending) else { return }
    // Request permissions only after an explicit in-session microphone gesture.
    AVAudioSession.sharedInstance().requestRecordPermission { [weak self] allowed in
      DispatchQueue.main.async {
        guard let self, self.id == value else { return }
        guard allowed else { self.cancel("ERR_VOICE_PERMISSION"); return }
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
          DispatchQueue.main.async {
            guard let self, self.id == value else { return }
            guard status == .authorized else { self.cancel("ERR_VOICE_PERMISSION"); return }
            self.capture(value)
          }
        }
      }
    }
  }
  private func capture(_ value: String) {
    guard foreground(), let recognizer = localRecognizer() else { cancel("ERR_VOICE_FOREGROUND"); return }
    do {
      try activate(.record, .measurement)
      let audio = AVAudioEngine()
      let bufferRequest = SFSpeechAudioBufferRecognitionRequest()
      bufferRequest.requiresOnDeviceRecognition = true
      bufferRequest.shouldReportPartialResults = true
      bufferRequest.taskHint = .confirmation
      engine = audio
      request = bufferRequest
      let input = audio.inputNode
      let format = input.outputFormat(forBus: 0)
      guard format.sampleRate > 0, format.channelCount > 0 else { cancel("ERR_LOCAL_VOICE"); return }
      input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in bufferRequest.append(buffer) }
      installedTap = true
      task = recognizer.recognitionTask(with: bufferRequest) { [weak self] result, error in
        DispatchQueue.main.async {
          guard let self, self.id == value else { return }
          guard self.foreground() else { self.cancel("ERR_VOICE_FOREGROUND"); return }
          if let result {
            let text = result.bestTranscription.formattedString
            guard text.count <= 1024, text.utf8.count <= 4096 else { self.cancel("ERR_LOCAL_VOICE"); return }
            if result.isFinal { self.finish(text, nil); return }
            self.emit?("onPartial", ["request_id": value, "text": text])
          }
          if error != nil { self.cancel("ERR_LOCAL_VOICE") }
        }
      }
      audio.prepare()
      try audio.start()
      emit?("onListening", ["request_id": value])
    } catch { cancel("ERR_LOCAL_VOICE") }
  }
  func stop(_ value: String) {
    guard id == value, !speaking else { return }
    guard task != nil else { cancel(); return }
    engine?.stop()
    request?.endAudio()
    task?.finish()
  }
  func speak(_ value: String, text: String, pending: Promise) {
    guard text.count <= 1000, text.utf8.count <= 4000, let local = voice() else {
      pending.reject("ERR_LOCAL_VOICE", "Local speech playback unavailable."); return
    }
    guard begin(value, pending) else { return }
    do {
      try activate(.playback, .spokenAudio)
      speaking = true
      let output = AVSpeechUtterance(string: text)
      output.voice = local
      utterance = output
      speech.speak(output)
    } catch { cancel("ERR_LOCAL_VOICE") }
  }
  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    if speaking && utterance === self.utterance { finish(nil, nil) }
  }
  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    if speaking && utterance === self.utterance { cancel() }
  }
}

public final class AssistantVoiceModule: Module {
  private var session: LocalVoiceSession?
  public func definition() -> ModuleDefinition {
    Name("AssistantVoice")
    Events("onListening", "onPartial")
    OnCreate {
      DispatchQueue.main.async {
        let session = LocalVoiceSession()
        session.emit = { [weak self] name, event in self?.sendEvent(name, event) }
        self.session = session
      }
    }
    OnAppEntersBackground { DispatchQueue.main.async { self.session?.cancel("ERR_VOICE_FOREGROUND") } }
    OnDestroy { DispatchQueue.main.async { self.session?.cancel(); self.session = nil } }
    AsyncFunction("availability") { () -> [String: Any] in
      self.session?.availability() ?? ["recognition": false, "synthesis": false, "message": "Local voice unavailable. Type your command."]
    }.runOnQueue(.main)
    AsyncFunction("listen") { (id: String, consent: Bool, promise: Promise) in
      guard let session = self.session else { promise.reject("ERR_LOCAL_VOICE", "Local voice unavailable."); return }
      session.listen(id, consent: consent, pending: promise)
    }.runOnQueue(.main)
    AsyncFunction("stop") { (id: String) in self.session?.stop(id) }.runOnQueue(.main)
    AsyncFunction("cancel") { (id: String) in self.session?.cancel("ERR_VOICE_CANCELLED", requestId: id) }.runOnQueue(.main)
    AsyncFunction("speak") { (id: String, text: String, promise: Promise) in
      guard let session = self.session else { promise.reject("ERR_LOCAL_VOICE", "Local voice unavailable."); return }
      session.speak(id, text: text, pending: promise)
    }.runOnQueue(.main)
  }
}
