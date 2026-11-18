package ai.contexify.security

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.media.AudioManager
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner

/** Read-only prerequisites, not permission, enrollment, confirmation or execution evidence. */
internal object DeviceControlReadiness {

  fun inspect(context: Context, activity: Activity?): Map<String, Any> {
    val resumed = (activity as? LifecycleOwner)?.lifecycle?.currentState
      ?.isAtLeast(Lifecycle.State.RESUMED) == true
    val state = when {
      activity == null || activity.isFinishing || activity.isDestroyed || !resumed -> "foreground_required"
      else -> runCatching {
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (keyguard.isDeviceLocked) "device_locked" else "foreground_unlocked"
      }.getOrDefault("unavailable")
    }
    // Never query package installation or audio services while locked/backgrounded.
    val active = state == "foreground_unlocked"
    val volume = if (!active) "unavailable" else runCatching {
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      when {
        audio.isVolumeFixed -> "fixed_volume"
        audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC) <= 0 -> "unavailable"
        else -> "available"
      }
    }.getOrDefault("unavailable")
    val catalog = ReviewedApplications.packages.mapValues { (_, packages) ->
      if (!active) "unavailable" else runCatching {
        if (packages.any { context.packageManager.getLaunchIntentForPackage(it) != null })
          "available" else "no_reviewed_handler"
      }.getOrDefault("unavailable")
    }
    return mapOf(
      "protocol_version" to 1,
      "platform" to "android",
      "execution_enabled" to false,
      "context" to state,
      "media_volume" to volume,
      "app_brightness" to if (active && activity?.window != null) "available" else "unavailable",
      "applications" to catalog
    )
  }
}
