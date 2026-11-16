package ai.contexify.voice

import android.Manifest
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

/** No audio files, network client, wake listener, transcript log or action executor. */
class AssistantVoiceModule : Module() {
  private class VoiceFailure(val reason: String) : IllegalStateException()
  private val handler = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var speech: TextToSpeech? = null
  private var listening: Promise? = null
  private var speaking: Promise? = null
  private var requestId: String? = null
  private var timeout: Runnable? = null
  private var supportTimeout: Runnable? = null
  private var captureStarted = false
  private var focus: AudioFocusRequest? = null
  private var focusManager: AudioManager? = null
  private fun context(): Context = requireNotNull(appContext.reactContext)
  private fun foreground() {
    val activity = appContext.currentActivity ?: throw VoiceFailure("ERR_VOICE_FOREGROUND")
    val keyguard = context().getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    // A React Native modal owns another window while the host activity stays resumed.
    val resumed = (activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true
    if (keyguard.isDeviceLocked || activity.isFinishing || activity.isDestroyed || !resumed)
      throw VoiceFailure("ERR_VOICE_FOREGROUND")
  }
  private fun available(): Boolean = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context())
  private fun active(id: String) = requestId == id && (listening != null || speaking != null)
  private fun arm(id: String, milliseconds: Long) {
    timeout?.let { handler.removeCallbacks(it) }
    timeout = Runnable { if (active(id)) cancelAll("ERR_VOICE_TIMEOUT") }.also { handler.postDelayed(it, milliseconds) }
  }
  private fun audioManager() = context().getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private fun attributes() = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
  private fun acquireFocus(id: String): Boolean {
    if (Build.VERSION.SDK_INT < 26) return false
    val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
      .setAudioAttributes(attributes()).setOnAudioFocusChangeListener({ change ->
        if (change < 0 && active(id)) cancelAll("ERR_VOICE_FOCUS")
      }, handler).build()
    focus = request
    val manager = audioManager()
    focusManager = manager
    return manager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
  }
  private fun release() {
    timeout?.let { handler.removeCallbacks(it) }; timeout = null
    val request = focus; focus = null
    val manager = focusManager; focusManager = null
    if (Build.VERSION.SDK_INT >= 26 && request != null) manager?.abandonAudioFocusRequest(request)
  }
  private fun finishListen(text: String? = null, reason: String = "ERR_VOICE_CANCELLED") {
    val promise = listening ?: return
    listening = null; requestId = null
    captureStarted = false
    supportTimeout?.let { handler.removeCallbacks(it) }; supportTimeout = null
    val current = recognizer; recognizer = null
    runCatching { current?.cancel() }
    runCatching { current?.destroy() }
    runCatching { release() }
    if (text != null) promise.resolve(text)
    else promise.reject(reason, "On-device speech did not produce a transcript.", null)
  }
  private fun finishSpeech(success: Boolean = false) {
    val promise = speaking ?: return
    speaking = null; requestId = null
    val current = speech; speech = null
    runCatching { current?.stop() }
    runCatching { current?.shutdown() }
    runCatching { release() }
    if (success) promise.resolve(null)
    else promise.reject("ERR_LOCAL_VOICE", "Local speech playback stopped or unavailable.", null)
  }
  private fun cancelAll(reason: String = "ERR_VOICE_CANCELLED") { finishListen(reason = reason); finishSpeech() }
  private fun beginListening(id: String) {
    if (!active(id)) return
    if (Build.VERSION.SDK_INT < 31) { finishListen(); return }
    try {
      foreground()
      check(available())
      if (!acquireFocus(id)) { finishListen(reason = "ERR_VOICE_FOCUS"); return }
      val current = SpeechRecognizer.createOnDeviceSpeechRecognizer(context())
      recognizer = current
      current.setRecognitionListener(object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
          if (!active(id)) return
          try { foreground(); sendEvent("onListening", mapOf("request_id" to id)) }
          catch (_: Exception) { finishListen(reason = "ERR_VOICE_FOREGROUND") }
        }
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {} // Deliberately discard; never persist audio.
        override fun onEndOfSpeech() { if (active(id)) arm(id, 5000) }
        override fun onError(error: Int) {
          if (active(id)) finishListen(reason = if (error in 1..13) "ERR_SPEECH_$error" else "ERR_LOCAL_VOICE")
        }
        override fun onEvent(eventType: Int, params: Bundle?) {}
        override fun onPartialResults(results: Bundle?) {
          if (!active(id)) return
          try {
            foreground()
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            if (text.length > 1024) finishListen()
            else sendEvent("onPartial", mapOf("request_id" to id, "text" to text))
          } catch (_: Exception) { finishListen(reason = "ERR_VOICE_FOREGROUND") }
        }
        override fun onResults(results: Bundle?) {
          if (!active(id)) return
          try {
            foreground()
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            finishListen(text?.takeIf { it.isNotBlank() && it.length <= 1024 }, "ERR_SPEECH_7")
          } catch (_: Exception) { finishListen(reason = "ERR_VOICE_FOREGROUND") }
        }
      })
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      var settled = false
      fun start(installed: List<String>) {
        if (settled || !active(id) || recognizer !== current) return
        settled = true
        supportTimeout?.let { handler.removeCallbacks(it) }; supportTimeout = null
        try {
          foreground()
          val language = EnglishSpeechLanguage.choose(installed, Locale.getDefault().toLanguageTag())
          captureStarted = true
          current.startListening(Intent(intent).putExtra(RecognizerIntent.EXTRA_LANGUAGE, language))
        } catch (error: Exception) {
          finishListen(reason = (error as? VoiceFailure)?.reason ?: "ERR_LOCAL_VOICE")
        }
      }
      if (Build.VERSION.SDK_INT >= 33) {
        // This queries the on-device service only. Never use online/supported-but-
        // not-installed lists, trigger a download or restart a failed capture.
        supportTimeout = Runnable { start(emptyList()) }.also { handler.postDelayed(it, 2000) }
        try {
          current.checkRecognitionSupport(intent, context().mainExecutor, object : RecognitionSupportCallback {
            override fun onSupportResult(support: RecognitionSupport) { start(support.installedOnDeviceLanguages) }
            override fun onError(error: Int) { start(emptyList()) }
          })
        } catch (_: Exception) { start(emptyList()) }
      } else start(emptyList())
    } catch (error: Exception) {
      finishListen(reason = (error as? VoiceFailure)?.reason ?: "ERR_LOCAL_VOICE")
    }
  }
  override fun definition() = ModuleDefinition {
    Name("AssistantVoice")
    Events("onListening", "onPartial")
    OnActivityEntersBackground { handler.post { cancelAll("ERR_VOICE_FOREGROUND") } }
    OnActivityDestroys { handler.post { cancelAll("ERR_VOICE_FOREGROUND") } }
    OnDestroy { handler.post { cancelAll("ERR_VOICE_FOREGROUND") } }

    AsyncFunction("availability") {
      val recognition = available()
      mapOf("recognition" to recognition,
        "synthesis" to context().packageManager.queryIntentServices(Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), 0).isNotEmpty(),
        "message" to if (recognition) "On-device speech service detected. Tap Use microphone to try voice." else "On-device speech is unavailable. You can still type.")
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("listen") { id: String, consent: Boolean, promise: Promise ->
      try {
        foreground()
        require(consent && id.length in 1..80)
        check(listening == null && speaking == null && available())
        val permissions = requireNotNull(appContext.permissions)
        requestId = id; listening = promise; arm(id, 30000)
        if (permissions.hasGrantedPermissions(Manifest.permission.RECORD_AUDIO)) beginListening(id)
        else permissions.askForPermissions({ _ -> handler.post {
          if (active(id)) {
            if (permissions.hasGrantedPermissions(Manifest.permission.RECORD_AUDIO)) beginListening(id) else finishListen(reason = "ERR_VOICE_PERMISSION")
          }
        } }, Manifest.permission.RECORD_AUDIO)
      } catch (error: Exception) {
        val reason = (error as? VoiceFailure)?.reason ?: "ERR_LOCAL_VOICE"
        if (listening === promise) finishListen(reason = reason)
        else promise.reject(reason, "On-device microphone unavailable. Type or try again.", null)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") { id: String ->
      if (active(id)) {
        if (listening != null) {
          if (recognizer != null && captureStarted) { recognizer?.stopListening(); arm(id, 5000) } else finishListen()
        } else finishSpeech()
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("cancel") { id: String -> if (active(id)) cancelAll() }.runOnQueue(Queues.MAIN)

    AsyncFunction("speak") { id: String, text: String, promise: Promise ->
      try {
        foreground()
        require(id.length in 1..80 && text.length in 1..1000)
        check(listening == null && speaking == null)
        requestId = id; speaking = promise; arm(id, 30000)
        check(acquireFocus(id))
        speech = TextToSpeech(context()) { status -> handler.post {
          if (active(id)) try {
            foreground()
            val current = requireNotNull(speech)
            check(status == TextToSpeech.SUCCESS)
            val voice = requireNotNull(current.voices?.firstOrNull {
              it.locale.language == "en" && !it.isNetworkConnectionRequired &&
                !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
            })
            check(current.setVoice(voice) == TextToSpeech.SUCCESS)
            current.setAudioAttributes(attributes())
            current.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
              override fun onStart(utteranceId: String?) {}
              override fun onDone(utteranceId: String?) { handler.post { if (active(id)) finishSpeech(true) } }
              override fun onError(utteranceId: String?) { handler.post { if (active(id)) finishSpeech() } }
            })
            check(current.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), id) == TextToSpeech.SUCCESS)
          } catch (_: Exception) { finishSpeech() }
        } }
      } catch (_: Exception) {
        if (speaking === promise) finishSpeech()
        else promise.reject("ERR_LOCAL_VOICE", "Local speech playback unavailable.", null)
      }
    }.runOnQueue(Queues.MAIN)
  }
}
