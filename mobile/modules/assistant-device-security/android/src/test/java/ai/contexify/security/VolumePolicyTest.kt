package ai.contexify.security

import org.junit.Assert.*
import org.junit.Test

class VolumePolicyTest {
  @Test fun quantizationNeverExceedsApprovedPercent() {
    for (max in listOf(1, 3, 15, 25, 100, 150, 10000)) for (percent in 0..70) {
      val target = VolumePolicy.target(percent, 0, max)
      assertTrue(target * 100 <= percent * max)
      assertTrue((target + 1) * 100 > percent * max)
    }
  }

  @Test fun exactAndQuantizedLimits() {
    assertEquals(0, VolumePolicy.target(0, 0, 15))
    assertEquals(7, VolumePolicy.target(50, 0, 15))
    assertEquals(10, VolumePolicy.target(70, 0, 15))
    assertEquals(70, VolumePolicy.target(70, 0, 100))
  }

  @Test fun unavailableAndInvalidRequestsAreRejected() {
    for (limits in listOf(Triple(71, 0, 15), Triple(-1, 0, 15), Triple(50, 0, 0),
      Triple(50, 0, 10001), Triple(0, 1, 15), Triple(50, 16, 15), Triple(50, -1, 15))) {
      assertThrows(IllegalArgumentException::class.java) { VolumePolicy.target(limits.first, limits.second, limits.third) }
    }
  }

  @Test fun restrictedOrChangedVolumeIsNotVerified() {
    assertTrue(VolumePolicy.verified(50, 0, 15, 7))
    assertFalse(VolumePolicy.verified(50, 0, 15, 8))
    assertFalse(VolumePolicy.verified(50, 0, 15, -1))
    assertFalse(VolumePolicy.verified(50, 0, 15, 16))
  }
}
