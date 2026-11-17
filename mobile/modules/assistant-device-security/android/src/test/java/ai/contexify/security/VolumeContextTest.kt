package ai.contexify.security

import org.junit.Assert.*
import org.junit.Test

class VolumeContextTest {
  private fun snapshot() = VolumeContext("fixture", "https://fixture.invalid", "user", "install", 0, 100, 50, 3, 30000)
  @Test fun unchangedFreshBoundStateIsAccepted() {
    snapshot().requireCurrent("https://fixture.invalid", "user", "install", 0, 100, 50, 3, 29999)
  }
  @Test fun changedValuesLimitsGenerationAndExpiryAreRejected() {
    for (state in listOf(listOf(0, 100, 49, 3, 100), listOf(1, 100, 50, 3, 100),
      listOf(0, 99, 50, 3, 100), listOf(0, 100, 50, 4, 100), listOf(0, 100, 50, 3, 30000))) {
      assertThrows(IllegalStateException::class.java) {
        snapshot().requireCurrent("https://fixture.invalid", "user", "install", state[0], state[1], state[2], state[3].toLong(), state[4].toLong())
      }
    }
  }
  @Test fun otherOwnerInstallationAndOriginAreRejected() {
    for (binding in listOf(listOf("https://other.invalid", "user", "install"),
      listOf("https://fixture.invalid", "other", "install"), listOf("https://fixture.invalid", "user", "other"))) {
      assertThrows(IllegalStateException::class.java) {
        snapshot().requireCurrent(binding[0], binding[1], binding[2], 0, 100, 50, 3, 100)
      }
    }
  }
  @Test fun invalidReadingsAreNotRepresentable() {
    for (state in listOf(Triple(0, 0, 0), Triple(-1, 100, 50), Triple(0, 10001, 50), Triple(2, 100, 1), Triple(0, 100, 101))) {
      assertThrows(IllegalArgumentException::class.java) {
        VolumeContext("fixture", "https://fixture.invalid", "user", "install", state.first, state.second, state.third, 3, 30000)
      }
    }
  }
  @Test fun readingsAreReplacedAndConsumedExactlyOnce() {
    val store = VolumeContextStore()
    store.put(snapshot())
    store.put(snapshot().copy(id = "new"))
    assertThrows(IllegalStateException::class.java) { store.take("fixture", 3, 100) }
    assertEquals("new", store.take("new", 3, 100).id)
    assertThrows(IllegalArgumentException::class.java) { store.take("new", 3, 100) }
  }
  @Test fun cancelledGenerationsCannotConsumeOrDeleteANewerReading() {
    val store = VolumeContextStore()
    store.put(snapshot())
    store.invalidateBefore(4)
    assertThrows(IllegalArgumentException::class.java) { store.take("fixture", 3, 100) }
    store.put(snapshot().copy(generation = 5))
    store.invalidateBefore(4)
    assertThrows(IllegalStateException::class.java) { store.take("fixture", 4, 100) }
    assertEquals(5, store.take("fixture", 5, 100).generation.toInt())
  }
  @Test fun explicitClearAndExpiredReadingsCannotBeConsumed() {
    val store = VolumeContextStore()
    store.put(snapshot())
    assertThrows(IllegalStateException::class.java) { store.take("fixture", 3, 30000) }
    store.clear()
    assertThrows(IllegalArgumentException::class.java) { store.take("fixture", 3, 100) }
  }
}
