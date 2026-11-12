package ai.contexify.security

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.URI
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import org.json.JSONObject

class AssistantDeviceSecurityModule : Module() {
  private val keyStore: KeyStore get() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private fun context(): Context = requireNotNull(appContext.reactContext)
  private fun unlocked() {
    val manager = context().getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    check(manager.isDeviceSecure && !manager.isDeviceLocked) { "Unlock a passcode-protected device to manage assistant security." }
    check(appContext.currentActivity?.hasWindowFocus() == true) { "Assistant security requires a foreground activity." }
  }
  private fun id(value: String): String {
    require(UUID.fromString(value).toString() == value) { "Invalid installation identifier." }
    return value
  }
  private fun alias(value: String) = "ai.contexify.assistant." + id(value)
  private fun marker(value: String): File = File(context().noBackupFilesDir, "assistant-" + id(value))
  private fun binding(origin: String, userId: String): String = Base64.encodeToString(
    MessageDigest.getInstance("SHA-256").digest((origin + "\n" + userId).toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
  private fun publicKey(value: String): String {
    val key = keyStore.getCertificate(alias(value)).publicKey as ECPublicKey
    fun coordinate(bytes: ByteArray) = bytes.takeLast(32).toByteArray().let {
      ByteArray(32 - it.size) + it
    }
    val raw = byteArrayOf(4) + coordinate(key.w.affineX.toByteArray()) + coordinate(key.w.affineY.toByteArray())
    return Base64.encodeToString(raw, Base64.NO_WRAP)
  }

  override fun definition() = ModuleDefinition {
    Name("AssistantDeviceSecurity")

    AsyncFunction("createKey") { origin: String, userId: String ->
      unlocked()
      val uri = URI(origin)
      require(uri.scheme == "https" && uri.host != null && uri.rawPath.orEmpty().isEmpty() &&
        uri.userInfo == null && uri.query == null && uri.fragment == null && uri.port in listOf(-1, 443))
      require(userId.length in 1..128 && !userId.contains('\n'))
      val installation = UUID.randomUUID().toString()
      val builder = KeyGenParameterSpec.Builder(alias(installation), KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
      if (Build.VERSION.SDK_INT >= 28) builder.setUnlockedDeviceRequired(true)
      try {
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
          initialize(builder.build())
        }.generateKeyPair()
        marker(installation).writeText(binding(origin, userId), Charsets.UTF_8)
        mapOf("installation_id" to installation, "public_key" to publicKey(installation))
      } catch (error: Exception) {
        keyStore.deleteEntry(alias(installation))
        marker(installation).delete()
        throw IllegalStateException("Device key creation failed.")
      }
    }

    AsyncFunction("signChallenge") { installation: String, payload: String ->
      unlocked()
      require(payload.toByteArray(Charsets.UTF_8).size <= 2048)
      val data = JSONObject(payload)
      val expiry = data.getDouble("expires_at")
      val now = System.currentTimeMillis() / 1000.0
      require(expiry.isFinite() && expiry > now && expiry <= now + 65)
      require(data.getInt("protocol_version") == 1 && data.getString("purpose") in listOf("enroll", "session"))
      require(data.getString("platform") == "android" && data.getString("installation_id") == id(installation))
      require(data.getString("public_key") == publicKey(installation))
      require(marker(installation).isFile && marker(installation).readText(Charsets.UTF_8) ==
        binding(data.getString("origin"), data.getString("user_id"))) { "Device binding was not restored. Enroll again." }
      val key = keyStore.getKey(alias(installation), null) as java.security.PrivateKey
      val signature = Signature.getInstance("SHA256withECDSA").apply {
        initSign(key)
        update(payload.toByteArray(Charsets.UTF_8))
      }.sign()
      Base64.encodeToString(signature, Base64.NO_WRAP)
    }

    AsyncFunction("deleteKey") { installation: String ->
      keyStore.deleteEntry(alias(installation))
      marker(installation).delete()
      Unit
    }
  }
}
