package ai.contexify.security

import org.junit.Assert.*
import org.junit.Test

class BrightnessPolicyTest {
  @Test fun allSupportedPercentagesRoundTripThroughWindowFloats() {
    for (percent in 10..100) assertEquals(BrightnessPolicy.target(percent), BrightnessPolicy.observed(percent / 100f))
  }
  @Test fun rejectsOutOfRangeRequests() {
    for (percent in listOf(Int.MIN_VALUE, -1, 0, 9, 101, Int.MAX_VALUE)) {
      assertThrows(IllegalArgumentException::class.java) { BrightnessPolicy.target(percent) }
    }
  }
  @Test fun defaultNonFiniteAndInvalidReadbackCannotClaimVerification() {
    for (value in listOf(-1f, Float.NaN, Float.POSITIVE_INFINITY, -0.1f, 1.1f)) {
      assertThrows(IllegalArgumentException::class.java) { BrightnessPolicy.observed(value) }
    }
  }
  @Test fun firstOverrideRestoresTheCurrentWindowValue() {
    for (current in listOf(-1f, 0.3f, 1f)) {
      assertEquals(current, BrightnessPolicy.originalForOverride(current, null, null), 0f)
    }
  }
  @Test fun repeatedOwnedChangesKeepTheOriginalSetting() {
    assertEquals(-1f, BrightnessPolicy.originalForOverride(0.4f, -1f, 0.4f), 0f)
    assertEquals(0.3f, BrightnessPolicy.originalForOverride(0.8f, 0.3f, 0.8f), 0f)
  }
  @Test fun externalChangesBecomeTheNewRestorationValue() {
    assertEquals(0.8f, BrightnessPolicy.originalForOverride(0.8f, -1f, 0.4f), 0f)
    assertEquals(-1f, BrightnessPolicy.originalForOverride(-1f, 0.3f, 0.4f), 0f)
  }
}
