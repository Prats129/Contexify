package ai.contexify.security

import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Authenticated, versioned local metadata; no plaintext fallback. */
internal object RecoveryCipher {
  fun seal(plain: ByteArray, key: SecretKey, binding: ByteArray): ByteArray {
    require(plain.size <= 16384)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    cipher.updateAAD(binding)
    check(cipher.iv.size == 12)
    return byteArrayOf(1) + cipher.iv + cipher.doFinal(plain)
  }
  fun open(bytes: ByteArray, key: SecretKey, binding: ByteArray): ByteArray {
    require(bytes.size in 29..16413 && bytes[0] == 1.toByte())
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
    cipher.updateAAD(binding)
    return cipher.doFinal(bytes.copyOfRange(13, bytes.size))
  }
}
