package ai.contexify.security

import android.app.KeyguardManager
import android.app.AlertDialog
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
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
  private data class Approval(val snapshot: String, val revision: Int, val deadline: Long)
  private val approvals = mutableMapOf<String, Approval>()
  private var confirming = false
  private var confirmationDialog: AlertDialog? = null
  private var cancelConfirmation: (() -> Unit)? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  private val controlRunning = java.util.concurrent.atomic.AtomicBoolean(false)
  private val planRunning = java.util.concurrent.atomic.AtomicBoolean(false)
  private val planGeneration = java.util.concurrent.atomic.AtomicLong(0)
  private val brightnessEffect = AppBrightnessControl()
  private val volume by lazy {
    PercentControlExecutor(::context, { appContext.currentActivity }, { origin, user, installation ->
      require(marker(installation).isFile && marker(installation).readText(Charsets.UTF_8) == binding(origin, user))
    }, ::publicKey, ::sign, MediaVolumeControl(), controlRunning)
  }
  private val brightness by lazy {
    PercentControlExecutor(::context, { appContext.currentActivity }, { origin, user, installation ->
      require(marker(installation).isFile && marker(installation).readText(Charsets.UTF_8) == binding(origin, user))
    }, ::publicKey, ::sign, brightnessEffect, controlRunning)
  }
  private val application by lazy {
    ApplicationExecutor(::context, { appContext.currentActivity }, { origin, user, installation ->
      require(marker(installation).isFile && marker(installation).readText(Charsets.UTF_8) == binding(origin, user))
    }, ::publicKey, ::sign, controlRunning)
  }
  private val keyStore: KeyStore get() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private fun context(): Context = requireNotNull(appContext.reactContext)
  private fun unlocked() {
    val manager = context().getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    check(manager.isDeviceSecure && !manager.isDeviceLocked) { "Unlock a passcode-protected device to manage assistant security." }
    val activity = appContext.currentActivity
    check(activity != null && !activity.isFinishing && !activity.isDestroyed &&
      (activity as? androidx.lifecycle.LifecycleOwner)?.lifecycle?.currentState
        ?.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED) == true) { "Assistant security requires a foreground activity." }
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

  private fun simulation(installation: String, payload: String): SimulationPolicy.Envelope {
    unlocked()
    val envelope = SimulationPolicy.validate(payload)
    val data = envelope.fields
    require(data.getString("installation_id") == id(installation) && data.getString("public_key") == publicKey(installation))
    require(marker(installation).isFile && marker(installation).readText(Charsets.UTF_8) ==
      binding(data.getString("origin"), data.getString("user_id")))
    approvals.entries.removeAll { it.value.deadline <= System.currentTimeMillis() }
    return envelope
  }
  private fun sign(installation: String, payload: String): String {
    val key = keyStore.getKey(alias(installation), null) as java.security.PrivateKey
    return Base64.encodeToString(Signature.getInstance("SHA256withECDSA").apply {
      initSign(key)
      update(payload.toByteArray(Charsets.UTF_8))
    }.sign(), Base64.NO_WRAP)
  }
  private fun resetSimulation() {
    planGeneration.incrementAndGet()
    volume.cancel()
    brightness.cancel()
    application.cancel()
    brightnessEffect.restore()
    approvals.clear()
    cancelConfirmation?.invoke()
  }

  private fun <T> foreground(block: () -> T): T {
    var result: Result<T>? = null
    val done = java.util.concurrent.CountDownLatch(1)
    val valid = java.util.concurrent.atomic.AtomicBoolean(true)
    mainHandler.post {
      try { if (valid.get()) result = runCatching { unlocked(); block() } }
      finally { done.countDown() }
    }
    if (!done.await(5, java.util.concurrent.TimeUnit.SECONDS)) {
      valid.set(false)
      throw IllegalStateException("Foreground operation timed out.")
    }
    return requireNotNull(result).getOrThrow()
  }
  private fun recovery(origin: String, user: String, installation: String): PlanRecoveryStore {
    require(marker(installation).isFile && marker(installation).readText(Charsets.UTF_8) == binding(origin, user))
    return PlanRecoveryStore(context(), installation, binding(origin, user))
  }
  private fun executor(capability: String) = when (capability) {
    "media_volume.set" -> volume
    "brightness.set_app" -> brightness
    else -> throw IllegalArgumentException("Unsupported plan capability.")
  }

  override fun definition() = ModuleDefinition {
    Name("AssistantDeviceSecurity")
    // Compiled support only: no package query, permission or authority is granted.
    Function("operationCapabilitiesV2") { listOf("media_volume.set", "brightness.set_app", "application.open") }
    // Separate from signing/enrollment. This method cannot authorize or dispatch actions.
    AsyncFunction("deviceControlReadiness") {
      DeviceControlReadiness.inspect(context(), appContext.currentActivity)
    }.runOnQueue(Queues.MAIN)
    // The native worker obtains and consumes authority directly over HTTPS.
    AsyncFunction("executeVolume") { origin: String, user: String, installation: String, management: String, percent: Int, promise: Promise ->
      check(!planRunning.get())
      // Capture cancellation ownership in bridge order, before the worker can be delayed.
      val ticket = volume.begin()
      kotlin.concurrent.thread(name = "AssistantVolume", isDaemon = true) {
        try { promise.resolve(volume.execute(origin, user, installation, management, percent, ticket)) }
        catch (_: Exception) { promise.reject("ERR_VOLUME", "Volume control is unavailable. Check media volume before trying again.", null) }
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("cancelVolume") { planGeneration.incrementAndGet(); volume.cancel(); if (planRunning.get()) { brightness.cancel(); application.cancel() } }.runOnQueue(Queues.MAIN)
    AsyncFunction("readVolumeContext") { origin: String, user: String, installation: String ->
      check(!planRunning.get())
      volume.readVolumeContext(origin, user, installation)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("executeVolumeFromContext") { origin: String, user: String, installation: String, management: String, percent: Int, contextId: String, promise: Promise ->
      check(!planRunning.get())
      val (ticket, snapshot) = volume.beginWithContext(contextId)
      kotlin.concurrent.thread(name = "AssistantContextVolume", isDaemon = true) {
        try { promise.resolve(volume.execute(origin, user, installation, management, percent, ticket, snapshot)) }
        catch (_: Exception) { promise.reject("ERR_VOLUME_CONTEXT", "Volume context expired or changed. Review a fresh command.", null) }
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("executeBrightness") { origin: String, user: String, installation: String, management: String, percent: Int, promise: Promise ->
      check(!planRunning.get())
      val ticket = brightness.begin()
      kotlin.concurrent.thread(name = "AssistantBrightness", isDaemon = true) {
        try { promise.resolve(brightness.execute(origin, user, installation, management, percent, ticket)) }
        catch (_: Exception) { promise.reject("ERR_BRIGHTNESS", "App brightness is unavailable. Review the app window before trying again.", null) }
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("cancelBrightness") { planGeneration.incrementAndGet(); brightness.cancel(); if (planRunning.get()) { volume.cancel(); application.cancel() } }.runOnQueue(Queues.MAIN)

    AsyncFunction("executePlanV2") { origin: String, user: String, installation: String, management: String, encoded: String, promise: Promise ->
      unlocked()
      val plan = PlanProtocol.parse(encoded, System.currentTimeMillis())
      check(!controlRunning.get() && planRunning.compareAndSet(false, true))
      val owner = planGeneration.get()
      kotlin.concurrent.thread(name = "AssistantPlan", isDaemon = true) {
        try {
          val store = foreground { recovery(origin, user, installation) }
          val targets = foreground {
            check(owner == planGeneration.get())
            plan.steps.mapNotNull {
              if (it.capability == "application.open") it.id to application.preflight(origin, user, installation, requireNotNull(it.applicationId))
              else { executor(it.capability).preflight(origin, user, installation, requireNotNull(it.percent)); null }
            }.toMap()
          }
          val sessions = mutableMapOf<String, String>() // Native memory only, never journaled or returned.
          plan.steps.map { it.capability }.distinct().forEach {
            if (it == "application.open") application.validateOperationBinding(origin, user, installation, management, sessions)
            else executor(it).validateOperationBinding(origin, user, installation, management, sessions)
          }
          foreground { check(owner == planGeneration.get()) }
          val coordinator = PlanCoordinator(store, System::currentTimeMillis) { owner != planGeneration.get() }
          val result = coordinator.execute(plan) { step ->
            if (step.capability == "application.open") {
              val ticket = foreground { check(owner == planGeneration.get()); application.begin() }
              application.execute(origin, user, installation, management, requireNotNull(targets[step.id]), ticket,
                OperationIdentity(plan.id, plan.revision, step.id), plan.expiresAt, sessions)
            } else {
              val control = executor(step.capability)
              val start = foreground {
                check(owner == planGeneration.get())
                if (plan.contextId != null) control.beginWithContext(plan.contextId) else control.begin() to null
              }
              PlanProtocol.evidence(control.execute(origin, user, installation, management, requireNotNull(step.percent), start.first,
                start.second, OperationIdentity(plan.id, plan.revision, step.id), plan.expiresAt, sessions))
            }
          }
          promise.resolve(result.bridge())
        } catch (error: Exception) {
          val previous = runCatching {
            val store = foreground { recovery(origin, user, installation) }
            store.read(plan.id).also { require(it.digest == plan.digest && it.planRevision == plan.revision) }
          }.getOrNull()
          if (previous != null) promise.resolve(previous.copy(states = previous.states.map { if (it == "pending") "skipped" else it }).bridge())
          else if (error is ApplicationUnavailable) promise.reject("ERR_APP_UNAVAILABLE", error.message, null)
          else promise.reject("ERR_PLAN", "The plan stopped. Check previous actions before making a new request; no automatic retry is allowed.", null)
        } finally { controlRunning.set(false); planRunning.set(false) }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("reconcilePlansV2") { origin: String, user: String, installation: String, management: String, promise: Promise ->
      unlocked()
      check(!controlRunning.get() && planRunning.compareAndSet(false, true))
      val owner = planGeneration.get()
      kotlin.concurrent.thread(name = "AssistantPlanStatus", isDaemon = true) {
        try {
          val store = foreground { recovery(origin, user, installation) }
          val sessions = mutableMapOf<String, String>()
          // A remembered user ID/marker is not authentication. Check live device
          // authority before decrypting or returning even fully local evidence.
          volume.validateOperationBinding(origin, user, installation, management, sessions)
          val rows = store.recent(3)
          val deadline = android.os.SystemClock.elapsedRealtime() + 30000
          val results = rows.map { row ->
            val evidence = row.evidence.toMutableList()
            val states = row.states.map { if (it == "pending") "skipped" else it }.toMutableList()
            row.states.forEachIndexed { i, state ->
              if (state != "pending" && state != "skipped" && evidence[i]?.recorded != true &&
                owner == planGeneration.get() && android.os.SystemClock.elapsedRealtime() < deadline) {
                val remote = runCatching {
                  val identity = OperationIdentity(row.id, row.planRevision, i)
                  if (row.capabilities[i] == "application.open") {
                    val ticket = foreground { check(owner == planGeneration.get()); application.begin() }
                    application.operationStatus(origin, user, installation, management, identity,
                      requireNotNull(row.applications[i]), ticket, sessions)
                  } else {
                    val control = executor(row.capabilities[i])
                    val ticket = foreground { check(owner == planGeneration.get()); control.begin() }
                    control.operationStatus(origin, user, installation, management,
                      identity, requireNotNull(row.percents[i]), ticket, sessions)
                  }
                }.getOrNull()
                if (remote != null) { states[i] = remote.outcome; evidence[i] = remote }
              }
            }
            // Projection only: no journal edits, fresh approval, claim or OS writes.
            row.copy(states = states, evidence = evidence).bridge()
          }
          foreground { check(owner == planGeneration.get()) }
          promise.resolve(results)
        } catch (_: Exception) {
          promise.reject("ERR_PLAN_STATUS", "Recovery evidence is unavailable. No device action was performed or retried.", null)
        } finally { controlRunning.set(false); planRunning.set(false) }
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground { mainHandler.post { resetSimulation() } }
    OnActivityDestroys { mainHandler.post { resetSimulation() } }
    OnDestroy { mainHandler.post { resetSimulation() } }

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

    AsyncFunction("confirmSimulation") { installation: String, payload: String, promise: Promise ->
      if (confirming) {
        promise.reject("ERR_SIMULATION", "A simulation confirmation is already open.", null)
        return@AsyncFunction
      }
      try {
        val envelope = simulation(installation, payload)
        require(envelope.fields.getString("purpose") == "assistant_simulation_authorize" && envelope.revision == 1)
        check(approvals.size < 32)
        val activity = requireNotNull(appContext.currentActivity)
        confirming = true
        var settled = false
        val expiry = Runnable { cancelConfirmation?.invoke() }
        val dialog = AlertDialog.Builder(activity).setTitle("Simulation only")
          .setMessage(envelope.label + "\n\nNo device action will be performed.")
          .setPositiveButton("Approve simulation") { _, _ ->
            if (!settled) {
              settled = true
              try {
                val current = simulation(installation, payload)
                require(current.snapshot == envelope.snapshot)
                val signature = sign(installation, payload)
                approvals[current.fields.getString("action_id")] = Approval(current.snapshot, 1, System.currentTimeMillis() + 90000)
                promise.resolve(signature)
              } catch (error: Exception) { promise.reject("ERR_SIMULATION", "Simulation confirmation expired or unavailable.", error) }
            }
          }.setNegativeButton("Cancel") { _, _ ->
            if (!settled) { settled = true; promise.resolve(null) }
          }.create()
        dialog.setOnDismissListener {
          mainHandler.removeCallbacks(expiry)
          confirming = false
          confirmationDialog = null
          cancelConfirmation = null
          if (!settled) { settled = true; promise.resolve(null) }
        }
        cancelConfirmation = {
          if (!settled) { settled = true; promise.resolve(null) }
          dialog.dismiss()
        }
        confirmationDialog = dialog
        dialog.show()
        val remaining = ((envelope.fields.getDouble("expires_at") - System.currentTimeMillis() / 1000.0) * 1000)
          .toLong().coerceIn(1, 65000)
        mainHandler.postDelayed(expiry, remaining)
      } catch (error: Exception) {
        confirming = false
        confirmationDialog = null
        cancelConfirmation = null
        promise.reject("ERR_SIMULATION", "Simulation confirmation unavailable.", error)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("signSimulationStep") { installation: String, payload: String ->
      val envelope = simulation(installation, payload)
      val action = envelope.fields.getString("action_id")
      val approval = requireNotNull(approvals[action]) { "A native simulation confirmation is required." }
      require(approval.snapshot == envelope.snapshot && envelope.revision == approval.revision + 1)
      when (envelope.fields.getString("purpose")) {
        "assistant_simulation_claim" -> {
          require(approval.revision == 1)
          approvals[action] = approval.copy(revision = 2)
        }
        "assistant_simulation_receipt" -> {
          require(approval.revision == 2)
          approvals.remove(action)
        }
        else -> throw IllegalArgumentException("Unsupported simulation step.")
      }
      sign(installation, payload)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("deleteKey") { installation: String ->
      resetSimulation()
      keyStore.deleteEntry(alias(installation))
      marker(installation).delete()
      volume.forget(installation)
      brightness.forget(installation)
      PlanRecoveryStore(context(), installation, "").forget()
      Unit
    }.runOnQueue(Queues.MAIN)
  }
}
