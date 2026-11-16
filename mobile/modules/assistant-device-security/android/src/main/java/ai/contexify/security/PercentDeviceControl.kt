package ai.contexify.security

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.view.Window
import java.util.WeakHashMap

/** Compiled adapters only. All methods run on the main thread behind the executor. */
internal sealed interface PercentDeviceControl {
  val mode: String
  val capability: String
  val execution: String
  val title: String
  val confirmationButton: String
  fun confirmation(percent: Int, target: Int, maximum: Int): String
  fun requirePermission(context: Context) {}
  fun inspect(context: Context, activity: Activity, percent: Int): Triple<Int, Int, Int>
  fun apply(context: Context, activity: Activity, percent: Int, limits: Triple<Int, Int, Int>): Pair<String, Int?>
  fun restore() {}
}

internal class MediaVolumeControl : PercentDeviceControl {
  override val mode = "volume"
  override val capability = "media_volume.set"
  override val execution = "android_media_volume"
  override val title = "Change media volume?"
  override val confirmationButton = "Change volume"
  override fun confirmation(percent: Int, target: Int, maximum: Int) =
    "Set media volume to $percent% on this phone.\n\nAndroid will use step $target of $maximum. Calls and alarm volume are unchanged."
  override fun requirePermission(context: Context) {
    check(context.checkSelfPermission(Manifest.permission.MODIFY_AUDIO_SETTINGS) == PackageManager.PERMISSION_GRANTED)
  }
  private fun audio(context: Context) = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  override fun inspect(context: Context, activity: Activity, percent: Int): Triple<Int, Int, Int> {
    val audio = audio(context)
    check(!audio.isVolumeFixed)
    val maximum = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    val minimum = if (Build.VERSION.SDK_INT >= 28) audio.getStreamMinVolume(AudioManager.STREAM_MUSIC) else 0
    return Triple(minimum, maximum, VolumePolicy.target(percent, minimum, maximum))
  }
  override fun apply(context: Context, activity: Activity, percent: Int, limits: Triple<Int, Int, Int>): Pair<String, Int?> {
    val audio = audio(context)
    check(inspect(context, activity, percent) == limits)
    return try {
      audio.setStreamVolume(AudioManager.STREAM_MUSIC, limits.third, 0)
      val observed = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
      val outcome = if (audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC) != limits.second) "outcome_unknown"
        else if (VolumePolicy.verified(percent, limits.first, limits.second, observed)) "verified" else "failed"
      outcome to observed
    } catch (_: SecurityException) { "outcome_unknown" to null }
  }
}

internal class AppBrightnessControl : PercentDeviceControl {
  override val mode = "brightness"
  override val capability = "brightness.set_app"
  override val execution = "android_app_brightness"
  override val title = "Change Contexify brightness?"
  override val confirmationButton = "Change app brightness"
  override fun confirmation(percent: Int, target: Int, maximum: Int) =
    "Set Contexify's app-window brightness to $percent%.\n\nThis does not change system brightness or other apps. The previous app-window setting is restored when Contexify goes into the background."
  private var reviewedWindow: Window? = null
  private data class Override(val original: Float, val applied: Float)
  private val overrides = WeakHashMap<Window, Override>()
  override fun inspect(context: Context, activity: Activity, percent: Int): Triple<Int, Int, Int> {
    val target = BrightnessPolicy.target(percent)
    reviewedWindow = activity.window
    return Triple(0, BrightnessPolicy.MAXIMUM, target)
  }
  override fun apply(context: Context, activity: Activity, percent: Int, limits: Triple<Int, Int, Int>): Pair<String, Int?> {
    val window = requireNotNull(reviewedWindow)
    check(activity.window === window && limits == Triple(0, BrightnessPolicy.MAXIMUM, BrightnessPolicy.target(percent)))
    val attributes = window.attributes
    val previous = attributes.screenBrightness
    check(previous == -1f || (previous.isFinite() && previous in 0f..1f))
    val applied = percent / 100f
    val owned = overrides[window]
    // Keep the original only while we still own the current window setting.
    val original = BrightnessPolicy.originalForOverride(previous, owned?.original, owned?.applied)
    overrides[window] = Override(original, applied)
    attributes.screenBrightness = applied
    window.attributes = attributes
    val observed = BrightnessPolicy.observed(window.attributes.screenBrightness)
    return (if (observed == limits.third) "verified" else "failed") to observed
  }
  override fun restore() {
    for ((window, value) in overrides) {
      runCatching {
        val attributes = window.attributes
        // Do not overwrite another owner that changed the window since our action.
        if (attributes.screenBrightness == value.applied) {
          attributes.screenBrightness = value.original
          window.attributes = attributes
        }
      }
    }
    overrides.clear()
    reviewedWindow = null
  }
}
