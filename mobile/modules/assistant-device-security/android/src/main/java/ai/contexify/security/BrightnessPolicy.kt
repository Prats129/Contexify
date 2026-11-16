package ai.contexify.security

/** Fixed units describe the app window attribute, not measured display luminance. */
internal object BrightnessPolicy {
  const val MAXIMUM = 10000
  fun target(percent: Int): Int {
    require(percent in 10..100)
    return percent * 100
  }
  fun observed(value: Float): Int {
    require(value.isFinite() && value in 0f..1f)
    return kotlin.math.round(value * MAXIMUM).toInt()
  }
  fun originalForOverride(current: Float, previousOriginal: Float?, previousApplied: Float?): Float =
    if (previousOriginal != null && current == previousApplied) previousOriginal else current
}
