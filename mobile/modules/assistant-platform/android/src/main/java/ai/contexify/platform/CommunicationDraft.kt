package ai.contexify.platform

/** Pure policy, independent of Android intents and contact permissions. */
internal data class CommunicationDraft(val kind: String, val number: String, val body: String) {
  init {
    require(kind in setOf("dial", "sms"))
    require(Regex("\\+[1-9][0-9]{7,14}").matches(number))
    require(body.length <= 1000)
    require(body.none { it.code in 0..9 || it.code in 11..31 || it.code in 127..159 ||
      it.code in 0x202a..0x202e || it.code in 0x2066..0x2069 })
    var i = 0
    while (i < body.length) {
      if (body[i].isHighSurrogate()) {
        require(i + 1 < body.length && body[i + 1].isLowSurrogate()); i += 2
      } else { require(!body[i].isLowSurrogate()); i++ }
    }
    require(if (kind == "dial") body.isEmpty() else body.isNotBlank())
  }
}
