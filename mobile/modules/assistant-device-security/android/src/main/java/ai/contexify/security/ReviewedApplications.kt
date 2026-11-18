package ai.contexify.security

internal class ApplicationUnavailable(message: String) : IllegalStateException(message)

/** Compiled identifiers only. These are reviewed package names, not publisher attestation. */
internal object ReviewedApplications {
  val packages = mapOf(
    "spotify" to listOf("com.spotify.music"),
    "clock" to listOf("com.google.android.deskclock", "com.android.deskclock", "com.sec.android.app.clockpackage")
  )
  fun valid(application: String, target: String) = packages[application]?.contains(target) == true
  fun label(target: String): String = when (target) {
    "com.spotify.music" -> "Spotify"
    "com.google.android.deskclock" -> "Google Clock"
    "com.android.deskclock" -> "Android Clock"
    "com.sec.android.app.clockpackage" -> "Samsung Clock"
    else -> throw IllegalArgumentException("Unreviewed application handler.")
  }
}
