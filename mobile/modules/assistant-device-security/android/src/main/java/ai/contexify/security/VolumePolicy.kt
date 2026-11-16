package ai.contexify.security

/** Round down to a representable media step; never round above the approved percentage. */
internal object VolumePolicy {
  fun target(percent: Int, minimum: Int, maximum: Int): Int {
    require(percent in 0..70 && maximum in 1..10000 && minimum in 0..maximum)
    val index = percent * maximum / 100
    require(index >= minimum) { "Requested media step is unavailable." }
    return index
  }

  fun verified(percent: Int, minimum: Int, maximum: Int, observed: Int): Boolean =
    observed in minimum..maximum && observed == target(percent, minimum, maximum)
}
