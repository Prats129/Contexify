package ai.contexify.voice

import org.junit.Assert.assertEquals
import org.junit.Test

class EnglishSpeechLanguageTest {
  @Test fun prefersInstalledDeviceEnglish() {
    assertEquals("en-IN", EnglishSpeechLanguage.choose(listOf("en-US", "en-IN"), "en-IN"))
  }
  @Test fun usesInstalledEnglishBeforeUnavailableUS() {
    assertEquals("en-GB", EnglishSpeechLanguage.choose(listOf("hi-IN", "en-GB"), "en-US"))
  }
  @Test fun prefersUSWhenDeviceLanguageIsNotInstalled() {
    assertEquals("en-US", EnglishSpeechLanguage.choose(listOf("en-GB", "en-US"), "hi-IN"))
  }
  @Test fun normalizesProviderTags() {
    assertEquals("en-IN", EnglishSpeechLanguage.choose(listOf("EN_in", "en-IN"), "en_in"))
  }
  @Test fun rejectsNonEnglishAndMalformedTags() {
    assertEquals("en-US", EnglishSpeechLanguage.choose(listOf("hi-IN", "en-US?url=x", "en-"), "hi-IN"))
  }
  @Test fun fallbackIsEnglishButDoesNotInventInstalledSupport() {
    assertEquals("en-IN", EnglishSpeechLanguage.choose(emptyList(), "en-IN"))
    assertEquals("en-US", EnglishSpeechLanguage.choose(emptyList(), "fr-FR"))
  }
  @Test fun boundsUntrustedProviderCatalogs() {
    assertEquals("en-US", EnglishSpeechLanguage.choose(List(64) { "hi-IN" } + "en-GB", "fr-FR"))
    assertEquals("en-US", EnglishSpeechLanguage.choose(listOf("en-" + "a".repeat(100)), "fr-FR"))
  }
}
