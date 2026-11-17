package ai.contexify.security

/** Ephemeral native precondition, never a permit or a persisted device history. */
internal data class VolumeContext(
  val id: String, val origin: String, val user: String, val installation: String,
  val minimum: Int, val maximum: Int, val index: Int, val generation: Long, val deadline: Long
) {
  init {
    require(maximum in 1..10000 && minimum in 0..maximum && index in minimum..maximum)
  }
  fun requireCurrent(origin: String, user: String, installation: String, minimum: Int,
    maximum: Int, index: Int, generation: Long, now: Long) {
    check(this.origin == origin && this.user == user && this.installation == installation)
    check(this.generation == generation && now < deadline)
    check(this.minimum == minimum && this.maximum == maximum && this.index == index)
  }
}

/** Main-thread store: at most one reading, replaced on read and consumed before work. */
internal class VolumeContextStore {
  private var pending: VolumeContext? = null
  fun put(value: VolumeContext) { pending = value }
  fun clear() { pending = null }
  fun invalidateBefore(generation: Long) {
    if ((pending?.generation ?: -1) < generation) clear()
  }
  fun take(id: String, generation: Long, now: Long): VolumeContext {
    val value = requireNotNull(pending)
    check(value.id == id && value.generation == generation && now < value.deadline)
    clear()
    return value
  }
}
