package ai.contexify.platform

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class CommunicationDraftTest {
  private fun invalid(kind: String = "sms", number: String = "+12025550123", body: String = "test") {
    try { CommunicationDraft(kind, number, body); fail("Unsafe draft accepted") }
    catch (_: IllegalArgumentException) { }
  }
  @Test fun acceptsOnlyExplicitInternationalTargetsAndVisibleMessages() {
    assertEquals("dial", CommunicationDraft("dial", "+12025550123", "").kind)
    assertEquals("hello\nworld 🙂", CommunicationDraft("sms", "+12025550123", "hello\nworld 🙂").body)
    listOf("12025550123", "+0123456789", "+1,2025550123", "+12025550123;123", "+12025550123#", "+123", "+١٢٠٢٥٥٥٠١٢٣").forEach { invalid(number = it) }
    invalid(kind = "call"); invalid(kind = "dial", body = "text")
  }
  @Test fun rejectsHiddenControlsUnpairedSurrogatesAndOversizePayloads() {
    listOf("", " ", "x\u0000y", "x\u202ey", "x\u2066y", "x\t", "\ud800", "\udc00", "a".repeat(1001)).forEach { invalid(body = it) }
    assertEquals(1000, CommunicationDraft("sms", "+12025550123", "a".repeat(1000)).body.length)
  }
}
