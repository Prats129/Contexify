package ai.contexify.voice

import java.util.Locale

/** Choose only English tags reported as installed by the active on-device recognizer. */
internal object EnglishSpeechLanguage {
  private fun english(value: String): String? {
    if (value.length !in 2..35) return null
    val tag = value.replace('_', '-')
    if (!Regex("[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}").matches(tag)) return null
    val locale = Locale.forLanguageTag(tag)
    return locale.toLanguageTag().takeIf { locale.language == "en" }
  }

  fun choose(installed: List<String>, preferred: String): String {
    val deviceEnglish = english(preferred)
    val candidates = installed.take(64).mapNotNull(::english).distinct().sorted()
    return candidates.firstOrNull { it == deviceEnglish }
      ?: candidates.firstOrNull { it == "en-US" }
      ?: candidates.firstOrNull()
      // Older/unsupported check APIs may not report a catalog. This is an attempt,
      // not a claim that a model is installed; recognition still reports failures.
      ?: deviceEnglish ?: "en-US"
  }
}
