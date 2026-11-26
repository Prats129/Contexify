package ai.contexify.wake

import android.Manifest
import android.app.KeyguardManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/** In-memory PCM transport only. No service, network, transcript or action executor. */
class AssistantWakeModule : Module() {
  private data class Capture(val id: String, val recorder: AudioRecord)
  @Volatile private var capture: Capture? = null
  private val handler = Handler(Looper.getMainLooper())
  private var timeout: Runnable? = null
  private fun context(): Context = requireNotNull(appContext.reactContext)
  private fun enabled(): Boolean = context().packageManager
    .getApplicationInfo(context().packageName, PackageManager.GET_META_DATA)
    .metaData?.getBoolean("ai.contexify.assistant.WAKE_ENABLED", false) == true
  private fun foreground() {
    check(enabled())
    val activity = requireNotNull(appContext.currentActivity)
    val guard = context().getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    check(!guard.isDeviceLocked && !activity.isFinishing && !activity.isDestroyed)
    check((activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true)
  }
  @Synchronized private fun stop(id: String? = null) {
    val current = capture ?: return
    if (id != null && current.id != id) return
    capture = null
    timeout?.let { handler.removeCallbacks(it) }; timeout = null
    try { current.recorder.stop() } catch (_: IllegalStateException) { }
    current.recorder.release()
  }
  override fun definition() = ModuleDefinition {
    Name("AssistantWake")
    OnActivityEntersBackground { stop() }
    OnActivityDestroys { stop() }
    OnDestroy { stop() }
    Function("available") {
      enabled() && context().assets.list("assistant-wake")?.contains("encoder.onnx") == true
    }
    AsyncFunction("prepareModel") {
      check(enabled())
      // All files originate from the hash-verified build artifact, never a URL
      // or a caller-supplied model path. Overwrite the private cache on each load.
      val destination = File(context().filesDir, "assistant-wake-model")
      check(destination.isDirectory || destination.mkdirs())
      for (name in listOf("encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt", "keywords.txt")) {
        context().assets.open("assistant-wake/$name").use { input ->
          File(destination, name).outputStream().use { output -> input.copyTo(output) }
        }
      }
      destination.absolutePath
    }
    AsyncFunction("start") { id: String ->
      foreground()
      require(id.length in 1..80)
      check(context().checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
      check(capture == null)
      val minimum = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      check(minimum > 0)
      val recorder = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum, 12800))
      capture = Capture(id, recorder)
      try {
        check(recorder.state == AudioRecord.STATE_INITIALIZED)
        recorder.startRecording()
        check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING)
        timeout = Runnable { stop(id) }.also { handler.postDelayed(it, 30000) }
      } catch (error: RuntimeException) { stop(id); throw error }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("readSamples") { id: String ->
      val current = capture
      if (current == null || current.id != id) emptyList<Double>() else {
        val buffer = ShortArray(1600)
        val count = try { current.recorder.read(buffer, 0, buffer.size, AudioRecord.READ_NON_BLOCKING) }
          catch (_: IllegalStateException) { 0 }
        if (capture !== current || count == 0) emptyList<Double>()
        else if (count < 0) error("Wake capture unavailable")
        else List(count) { buffer[it].toDouble() / 32768.0 }
      }
    }
    AsyncFunction("stop") { id: String -> stop(id) }.runOnQueue(Queues.MAIN)
    Function("isRecording") { id: String -> capture?.id == id }
  }
}
