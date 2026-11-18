package ai.contexify.security

import android.app.Activity
import android.app.AlertDialog
import android.app.KeyguardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

/** Online, terminal launcher handoff. The encrypted coordinator owns crash recovery.
 * After dispatch, backgrounding can only finish its bounded receipt; never another effect.
 */
internal class ApplicationExecutor(
  private val context: () -> Context,
  private val activity: () -> Activity?,
  private val binding: (String, String, String) -> Unit,
  private val publicKey: (String) -> String,
  private val sign: (String, String) -> String,
  private val running: AtomicBoolean,
) {
  private val generation = AtomicLong(0)
  private val handedOff = AtomicBoolean(false)
  private val main = Handler(Looper.getMainLooper())
  private var dialog: AlertDialog? = null
  private val protocol = NativeControlProtocol("application", "application.open", generation::get, binding, publicKey)
  fun cancel() {
    // A pending action is cancelled. An already dispatched handoff cannot be undone;
    // allow only its receipt to finish while the coordinator stops all continuation.
    if (!handedOff.get()) generation.incrementAndGet()
    main.post { dialog?.dismiss() }
  }
  fun begin(): Long {
    check(Looper.myLooper() == Looper.getMainLooper() && running.compareAndSet(false, true))
    handedOff.set(false)
    return generation.get()
  }
  private fun active(ticket: Long) {
    check(ticket == generation.get())
    ExecutionGate.requireEnabled(context())
    val guard = context().getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    val host = requireNotNull(activity())
    check(guard.isDeviceSecure && !guard.isDeviceLocked && !host.isFinishing && !host.isDestroyed &&
      (host as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true)
    if (dialog != null) check(dialog?.window?.decorView?.hasWindowFocus() == true)
  }
  private fun <T> onMain(block: () -> T): T {
    val done = CountDownLatch(1)
    val valid = AtomicBoolean(true)
    var answer: Result<T>? = null
    main.post { try { if (valid.get()) answer = runCatching(block) } finally { done.countDown() } }
    if (!done.await(5, TimeUnit.SECONDS)) { valid.set(false); error("Foreground operation timed out.") }
    return requireNotNull(answer).getOrThrow()
  }
  fun preflight(origin: String, user: String, installation: String, application: String): ApplicationTarget {
    active(generation.get()); NativeControlProtocol.validateOrigin(origin); binding(origin, user, installation)
    return ApplicationHandoff.resolve(context(), application)
  }
  private fun session(origin: String, management: String, ticket: Long, deadline: Long, sessions: MutableMap<String, String>): String =
    sessions.getOrPut("application") {
      val response = protocol.post(origin, management, "/sessions", JSONObject(), ticket, deadline)
      require(response.getString("scope") == "assistant:application")
      response.getString("access_token")
    }
  private fun identity(value: OperationIdentity) = JSONObject().put("protocol_version", 2)
    .put("plan_id", value.planId).put("plan_revision", value.revision).put("step_id", value.stepId)
  private fun action(target: ApplicationTarget) = JSONObject().put("capability_id", "application.open")
    .put("schema_version", 1).put("application_id", target.applicationId).put("package_id", target.packageId)
  fun validateOperationBinding(origin: String, user: String, installation: String, management: String, sessions: MutableMap<String, String>) {
    val ticket = generation.get()
    onMain { active(ticket); binding(origin, user, installation) }
    val deadline = SystemClock.elapsedRealtime() + 15000
    val token = session(origin, management, ticket, deadline, sessions)
    val owner = protocol.post(origin, token, "/operations/identity", JSONObject(), ticket, deadline)
    require(owner.get("protocol_version") == 2 && owner.getString("origin") == origin &&
      owner.getString("user_id") == user && owner.getString("installation_id") == installation &&
      owner.getString("public_key") == publicKey(installation))
    require(UUID.fromString(owner.getString("device_id")).version() == 4)
    onMain { active(ticket); binding(origin, user, installation) }
  }
  private fun confirm(target: ApplicationTarget, expiry: Double, ticket: Long): Boolean {
    val done = CountDownLatch(1)
    val approved = AtomicBoolean(false)
    val valid = AtomicBoolean(true)
    val timeout = Runnable { dialog?.dismiss() }
    onMain {
      active(ticket)
      check(dialog == null)
      val shown = AlertDialog.Builder(requireNotNull(activity())).setTitle("Open reviewed app")
        .setMessage("Open ${ReviewedApplications.label(target.packageId)} (${target.packageId})?\n\nThis leaves Contexify. No other actions will run in the background. Opening an app does not start music or create an alarm.")
        .setPositiveButton("Open app") { _, _ ->
          if (valid.get() && System.currentTimeMillis() / 1000.0 < expiry)
            approved.set(runCatching { active(ticket); true }.getOrDefault(false))
        }.setNegativeButton("Cancel", null).create()
      dialog = shown
      shown.setOnDismissListener { main.removeCallbacks(timeout); if (dialog === shown) dialog = null; done.countDown() }
      shown.show()
      shown.getButton(AlertDialog.BUTTON_POSITIVE).apply {
        filterTouchesWhenObscured = true
        setOnTouchListener { _, event -> (event.flags and (MotionEvent.FLAG_WINDOW_IS_OBSCURED or MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED)) != 0 }
      }
      main.postDelayed(timeout, (expiry * 1000 - System.currentTimeMillis()).toLong().coerceIn(1, 60000))
    }
    if (!done.await(61, TimeUnit.SECONDS)) { valid.set(false); main.post { dialog?.dismiss() }; return false }
    return approved.get() && ticket == generation.get()
  }
  fun execute(origin: String, user: String, installation: String, management: String, target: ApplicationTarget,
    ticket: Long, operation: OperationIdentity, validUntil: Long, sessions: MutableMap<String, String>): StepEvidence {
    var claimed = false
    var outcome = "failed"
    var recorded = false
    try {
      onMain { active(ticket); binding(origin, user, installation) }
      check(System.currentTimeMillis() < validUntil)
      val deadline = SystemClock.elapsedRealtime() + minOf(120000, validUntil - System.currentTimeMillis())
      val token = session(origin, management, ticket, deadline, sessions)
      val args = action(target)
      val task = protocol.post(origin, token, "/operations", identity(operation).put("action", args), ticket, deadline)
      val taskId = task.getString("task_id")
      require(UUID.fromString(taskId).toString() == taskId && task.getString("mode") == "application" &&
        task.getString("state") == "awaiting_confirmation" && task.getInt("revision") == 1)
      fun request(path: String, body: JSONObject) = protocol.post(origin, token, "/tasks/$taskId$path", body, ticket, deadline)
      fun validate(value: JSONObject, purpose: String, revision: Int) = protocol.envelope(value, "assistant_application_$purpose",
        revision, origin, user, installation, token, taskId, args)
      fun proof(value: JSONObject, payload: String, revision: Int) = JSONObject().put("expected_revision", revision)
        .put("challenge_id", value.getString("challenge_id")).put("signature", sign(installation, payload))
      val challenge = request("/authorization-challenge", JSONObject().put("expected_revision", 1))
      val payload = validate(challenge, "authorize", 1)
      if (!confirm(target, minOf(validUntil / 1000.0, challenge.getDouble("expires_at")), ticket)) {
        outcome = "cancelled"
        if (ticket == generation.get()) runCatching { request("/cancel", JSONObject()) }
      } else {
        onMain { active(ticket); binding(origin, user, installation) }
        val permit = request("/authorize", proof(challenge, payload, 1))
        require(permit.getInt("action_revision") == 2)
        val claimChallenge = permit.getJSONObject("claim_challenge")
        val claimPayload = validate(claimChallenge, "claim", 2)
        val hash = MessageDigest.getInstance("SHA-256").digest(permit.getString("permit").toByteArray(Charsets.UTF_8))
          .joinToString("") { "%02x".format(it.toInt() and 255) }
        require(JSONObject(claimPayload).getString("permit_hash") == hash)
        claimed = true // Lost claim responses are unknown and must never be retried.
        val claim = request("/claim", proof(claimChallenge, claimPayload, 2).put("permit", permit.getString("permit")))
        require(claim.getInt("action_revision") == 3 && claim.getString("execution") == "android_application_handoff")
        val claimId = claim.getString("claim_id")
        require(UUID.fromString(claimId).toString() == claimId)
        val expiry = claim.getDouble("expires_at")
        require(expiry.isFinite() && expiry > System.currentTimeMillis() / 1000.0 && expiry <= System.currentTimeMillis() / 1000.0 + 20)
        val monotonicExpiry = SystemClock.elapsedRealtime() + (expiry * 1000 - System.currentTimeMillis()).toLong().coerceIn(0, 15000)
        onMain {
          active(ticket); binding(origin, user, installation)
          check(System.currentTimeMillis() < validUntil && System.currentTimeMillis() / 1000.0 < expiry && SystemClock.elapsedRealtime() < monotonicExpiry)
          ApplicationHandoff.launch(context(), requireNotNull(activity()), target)
          handedOff.set(true)
          outcome = "handoff_requested"
        }
        // Only fixed receipt endpoints remain after backgrounding. No further OS calls.
        runCatching {
          val result = JSONObject().put("expected_revision", 3).put("claim_id", claimId).put("outcome", outcome)
          val receiptChallenge = request("/receipt-challenge", result)
          val receiptPayload = validate(receiptChallenge, "receipt", 3)
          val fields = JSONObject(receiptPayload)
          require(fields.getString("claim_id") == claimId && fields.getString("outcome") == outcome)
          val receipt = request("/receipt", result.put("challenge_id", receiptChallenge.getString("challenge_id"))
            .put("signature", sign(installation, receiptPayload)))
          require(receipt.getString("state") == outcome && receipt.getString("task_id") == taskId)
          recorded = true
        }
      }
    } catch (_: Exception) {
      outcome = if (handedOff.get()) "handoff_requested" else if (claimed) "outcome_unknown"
        else if (ticket != generation.get()) "cancelled" else "failed"
    } finally { running.set(false); handedOff.set(false) }
    return StepEvidence(outcome, null, null, recorded, target.applicationId, target.packageId)
  }
  fun operationStatus(origin: String, user: String, installation: String, management: String, operation: OperationIdentity,
    application: String, ticket: Long, sessions: MutableMap<String, String>): StepEvidence? {
    try {
      onMain { active(ticket); binding(origin, user, installation) }
      val deadline = SystemClock.elapsedRealtime() + 15000
      val token = session(origin, management, ticket, deadline, sessions)
      val status = protocol.post(origin, token, "/operations/status", identity(operation), ticket, deadline)
      val args = status.getJSONObject("action")
      require(args.getString("capability_id") == "application.open" && args.getString("application_id") == application &&
        ReviewedApplications.valid(application, args.getString("package_id")))
      val state = status.getString("state")
      val result = status.optJSONObject("result") ?: return null
      require(state in setOf("handoff_requested", "failed", "outcome_unknown") && result.getString("outcome") == state)
      onMain { active(ticket); binding(origin, user, installation) }
      return StepEvidence(state, null, null, true, application, args.getString("package_id"))
    } finally { running.set(false) }
  }
}
