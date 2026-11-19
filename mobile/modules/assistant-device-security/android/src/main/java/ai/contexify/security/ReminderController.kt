package ai.contexify.security

import android.app.Activity
import android.app.AlertDialog
import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject

/** Foreground consent/authority boundary. Only approved immutable occurrences outlive it. */
internal class ReminderController(
  private val context: () -> Context,
  private val activity: () -> Activity?,
  private val binding: (String, String, String) -> Unit,
  private val bindingDigest: (String, String) -> String,
  private val publicKey: (String) -> String,
  private val sign: (String, String) -> String,
  private val running: AtomicBoolean,
) {
  private val generation = AtomicLong(0)
  private val main = Handler(Looper.getMainLooper())
  private var dialog: AlertDialog? = null
  fun begin(): Long {
    check(Looper.myLooper() == Looper.getMainLooper() && running.compareAndSet(false, true))
    return generation.get()
  }
  fun end() { running.set(false) }
  fun cancel() { generation.incrementAndGet(); main.post { dialog?.dismiss() } }
  private fun active(ticket: Long) {
    check(Build.VERSION.SDK_INT >= 26 && ticket == generation.get())
    ExecutionGate.requireEnabled(context())
    val host = requireNotNull(activity())
    val guard = context().getSystemService(KeyguardManager::class.java)
    check(guard.isDeviceSecure && !guard.isDeviceLocked && !host.isFinishing && !host.isDestroyed &&
      (host as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true)
    if (dialog != null) check(dialog?.window?.decorView?.hasWindowFocus() == true)
  }
  private fun <T> onMain(block: () -> T): T {
    val ready = CountDownLatch(1)
    val valid = AtomicBoolean(true)
    var result: Result<T>? = null
    main.post { try { if (valid.get()) result = runCatching(block) } finally { ready.countDown() } }
    if (!ready.await(5, TimeUnit.SECONDS)) { valid.set(false); error("Foreground reminder operation timed out.") }
    return requireNotNull(result).getOrThrow()
  }
  private fun wire(capability: String = "reminder.create") = NativeControlProtocol("reminder", capability, generation::get, binding, publicKey)
  private fun session(origin: String, user: String, installation: String, management: String, ticket: Long): String {
    NativeControlProtocol.validateOrigin(origin)
    onMain { active(ticket); binding(origin, user, installation) }
    val deadline = SystemClock.elapsedRealtime() + 15000
    val protocol = wire()
    val session = protocol.post(origin, management, "/sessions", JSONObject(), ticket, deadline)
    require(session.getString("scope") == "assistant:reminder")
    val token = session.getString("access_token")
    val owner = protocol.post(origin, token, "/operations/identity", JSONObject(), ticket, deadline)
    require(owner.get("protocol_version") == 2 && owner.getString("origin") == origin && owner.getString("user_id") == user &&
      owner.getString("installation_id") == installation && owner.getString("public_key") == publicKey(installation))
    ReminderVault.id(owner.getString("device_id"))
    onMain { active(ticket); binding(origin, user, installation) }
    return token
  }
  private fun storage(origin: String, token: String, ticket: Long) = wire().post(origin, token, "/storage", JSONObject(), ticket, SystemClock.elapsedRealtime() + 15000)
  private fun optionalReceiptOrCopy(block: () -> Unit) {
    try { block() }
    catch (error: NativeControlRejected) { if (error.status == 401) throw error }
    catch (_: Exception) { /* Preserve the known local outcome; never retry network uncertainty. */ }
  }
  private fun owner(vault: ReminderVault, origin: String, user: String, installation: String): ReminderOwner? = vault.owner()?.also {
    check(it.installation == installation && it.binding == bindingDigest(origin, user))
  }
  fun read(origin: String, user: String, installation: String, management: String, ticket: Long): String {
    val token = session(origin, user, installation, management, ticket)
    val settings = storage(origin, token, ticket)
    val vault = ReminderVault(context())
    onMain { active(ticket); binding(origin, user, installation) }
    // Disk and Keystore work runs on the worker; recheck foreground ownership before returning private data.
    val entries = synchronized(ReminderVault.lock) {
        val selected = owner(vault, origin, user, installation)
        if (selected == null) JSONArray() else {
          vault.prune(selected).forEach { ReminderAlarms.cancel(context(), it) }
          val rows = vault.ids().map { vault.read(selected, it) }
          val activeStates = setOf("scheduled", "schedule_unknown", "notification_unknown")
          val visible = rows.filter { it.state in activeStates }.sortedBy { it.times[it.index] }.take(64) +
            rows.filter { it.state !in activeStates }.sortedByDescending { it.times[it.index] }.take(8)
          JSONArray().also { list -> visible.forEach { row ->
            val details = row.body?.let { JSONObject(vault.privateBody(selected, row).getString("payload_json")) }
            list.put(JSONObject().put("reminder_id", row.id).put("state", row.state).put("next_at", row.times[row.index])
              .put("remaining", if (row.state == "scheduled") row.times.size - row.index else 0)
              .put("last_outcome", row.lastOutcome ?: JSONObject.NULL).put("details", details ?: JSONObject.NULL))
          } }
        }
    }
    onMain { active(ticket); binding(origin, user, installation) }
    return JSONObject().put("protocol_version", 1).put("storage", settings).put("items", entries)
      .put("time_zone", java.time.ZoneId.systemDefault().id).put("notifications_allowed", ReminderAlarms.allowed(context())).toString()
  }
  fun saved(origin: String, user: String, installation: String, management: String, after: String?, ticket: Long): String {
    if (after != null) ReminderVault.id(after)
    val token = session(origin, user, installation, management, ticket)
    val result = wire().post(origin, token, "/stored/list", JSONObject().put("after", after ?: JSONObject.NULL), ticket, SystemClock.elapsedRealtime() + 15000)
    onMain { active(ticket); binding(origin, user, installation) }
    return result.toString()
  }
  private fun confirm(message: String, expiry: Double, ticket: Long, validate: () -> Unit = {}): Boolean {
    val completed = CountDownLatch(1)
    val approved = AtomicBoolean(false)
    val valid = AtomicBoolean(true)
    val timeout = Runnable { dialog?.dismiss() }
    onMain {
      active(ticket); check(dialog == null)
      val shown = AlertDialog.Builder(requireNotNull(activity())).setTitle("Review reminder action").setMessage(message)
        .setPositiveButton("Approve") { _, _ ->
          if (valid.get() && System.currentTimeMillis() / 1000.0 < expiry)
            approved.set(runCatching { active(ticket); validate(); true }.getOrDefault(false))
        }.setNegativeButton("Cancel", null).create()
      dialog = shown
      shown.setOnDismissListener { main.removeCallbacks(timeout); if (dialog === shown) dialog = null; completed.countDown() }
      shown.show()
      shown.getButton(AlertDialog.BUTTON_POSITIVE).apply {
        filterTouchesWhenObscured = true
        setOnTouchListener { _, event -> (event.flags and (MotionEvent.FLAG_WINDOW_IS_OBSCURED or MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED)) != 0 }
      }
      main.postDelayed(timeout, (expiry * 1000 - System.currentTimeMillis()).toLong().coerceIn(1, 60000))
    }
    if (!completed.await(61, TimeUnit.SECONDS)) { valid.set(false); main.post { dialog?.dismiss() }; return false }
    return approved.get() && ticket == generation.get()
  }
  fun execute(origin: String, user: String, installation: String, management: String, kind: String, encoded: String, ticket: Long): String {
    require(kind in setOf("create", "cancel", "storage", "delete_saved"))
    val input = ReminderJSON.parse(encoded)
    val token = session(origin, user, installation, management, ticket)
    val settings = storage(origin, token, ticket)
    val vault = ReminderVault(context())
    var selectedOwner = onMain { active(ticket); owner(vault, origin, user, installation) }
    val salt = ReminderAlarms.nonce()
    val operationId = UUID.randomUUID().toString()
    val capability = "reminder.$kind"
    val protocol = wire(capability)
    var selected: ReminderEntry? = null
    var resolved: ReminderSchedule? = null
    val id: String?
    val payload: String
    val message: String
    var storageMode: String? = null
    var storageRevision: Int? = null
    when (kind) {
      "create" -> {
        resolved = ReminderJSON.schedule(input, System.currentTimeMillis())
        check(ReminderAlarms.allowed(context())) { "Allow reminder notifications first." }
        id = UUID.randomUUID().toString()
        payload = ReminderJSON.details(id, resolved).toString()
        message = resolved.title + "\n\n" + resolved.summary() + "\n\nAlready-approved alerts can notify offline. Sign out on this phone to stop them. Remote sign-out takes effect once this phone reconnects.\n\n" +
          if (settings.getString("mode") == "account") "An encrypted account copy will be sent to your configured server. It is not sent to Gemini." else "Private details stay only on this phone. Signing out deletes them."
      }
      "cancel" -> {
        ReminderJSON.fields(input, setOf("reminder_id"))
        id = ReminderVault.id(input.getString("reminder_id"))
        selected = onMain { active(ticket); vault.read(requireNotNull(selectedOwner), id) }
        val title = onMain { active(ticket); vault.privateBody(requireNotNull(selectedOwner), requireNotNull(selected)).getString("payload_json").let { JSONObject(it).getString("title") } }
        payload = JSONObject().put("reminder_id", id).put("revision", requireNotNull(selected).revision).toString()
        message = "Remove this reminder and cancel any future alerts:\n$title\n\nThis removes this device's local details and its saved server copy."
      }
      "storage" -> {
        ReminderJSON.fields(input, setOf("mode", "revision"))
        require(input.get("revision") is Int && input.getInt("revision") == settings.getInt("revision"))
        storageMode = input.getString("mode"); storageRevision = input.getInt("revision")
        require(storageMode in setOf("device_only", "account"))
        check(storageMode != "account" || settings.getBoolean("account_storage_available")) { "Encrypted account storage is not configured." }
        id = null
        payload = input.toString()
        message = if (storageMode == "account") "Keep an encrypted account copy of new reminders on your configured server?\n\nReminder titles and schedules will be sent over HTTPS and encrypted in your database. Your server can decrypt them after account authentication. They are not sent to Gemini. Existing local reminders are not uploaded automatically. Signing out stops local alerts; server copies remain until expiry or deletion. Restored copies require a new date review and approval."
          else "Keep new reminder details only on this device?\n\nThis deletes saved server copies created by this device and prevents further uploads. Local schedules remain. Other devices' saved copies are unaffected."
      }
      else -> {
        ReminderJSON.fields(input, setOf("reminder_id"))
        id = ReminderVault.id(input.getString("reminder_id"))
        payload = input.toString()
        val copy = protocol.post(origin, token, "/stored/read", input, ticket, SystemClock.elapsedRealtime() + 15000)
        val details = copy.getJSONObject("details")
        require(details.getString("reminder_id") == id)
        onMain { active(ticket); binding(origin, user, installation) }
        message = "Delete this saved account copy?\n\n${details.getString("title")}\n${details.getString("date")} ${details.getString("time")} (${details.getString("zone")})\n\nThis does not cancel alerts already approved on another phone."
      }
    }
    require(payload.toByteArray(Charsets.UTF_8).size <= 4096)
    val action = JSONObject().put("capability_id", capability).put("schema_version", 1)
      .put("commitment", ReminderVault.hash("reminder-v1\n$salt\n$payload")).put("reminder_id", id ?: JSONObject.NULL)
      .put("storage_mode", storageMode ?: JSONObject.NULL).put("settings_revision", storageRevision ?: JSONObject.NULL)
    val deadline = SystemClock.elapsedRealtime() + 120000
    val identity = JSONObject().put("protocol_version", 2).put("plan_id", operationId).put("plan_revision", 1).put("step_id", 0)
    var claimed = false
    var outcome = "failed"
    var recorded = false
    var copyState = "not_requested"
    try {
      val task = protocol.post(origin, token, "/operations", identity.put("action", action), ticket, deadline)
      val taskId = ReminderVault.id(task.getString("task_id"))
      require(task.getString("mode") == "reminder" && task.getString("state") == "awaiting_confirmation" && task.getInt("revision") == 1)
      fun request(path: String, body: JSONObject) = protocol.post(origin, token, "/tasks/$taskId$path", body, ticket, deadline)
      fun envelope(value: JSONObject, purpose: String, revision: Int) = protocol.envelope(value, "assistant_reminder_$purpose", revision, origin, user, installation, token, taskId, action)
      fun proof(value: JSONObject, bytes: String, revision: Int) = JSONObject().put("expected_revision", revision)
        .put("challenge_id", value.getString("challenge_id")).put("signature", sign(installation, bytes))
      val challenge = request("/authorization-challenge", JSONObject().put("expected_revision", 1))
      val authorization = envelope(challenge, "authorize", 1)
      if (!confirm(message, challenge.getDouble("expires_at"), ticket) {
          binding(origin, user, installation)
          selected?.let { entry -> check(vault.read(requireNotNull(selectedOwner), entry.id) == entry) }
          resolved?.let { schedule -> check(schedule.occurrences.first() > System.currentTimeMillis() + 1000) }
        }) {
        outcome = "cancelled"
        if (ticket == generation.get()) optionalReceiptOrCopy { request("/cancel", JSONObject()) }
      } else {
        onMain { active(ticket); binding(origin, user, installation) }
        val permit = request("/authorize", proof(challenge, authorization, 1))
        require(permit.getInt("action_revision") == 2)
        val claimChallenge = permit.getJSONObject("claim_challenge")
        val claimBytes = envelope(claimChallenge, "claim", 2)
        require(JSONObject(claimBytes).getString("permit_hash") == ReminderVault.hash(permit.getString("permit")))
        if (resolved != null) onMain {
          active(ticket); binding(origin, user, installation)
          selectedOwner = vault.activate(installation, bindingDigest(origin, user))
          selected = vault.reserve(requireNotNull(selectedOwner), requireNotNull(id), resolved.occurrences, taskId, payload, salt, ReminderAlarms.nonce())
        }
        claimed = true
        val claim = request("/claim", proof(claimChallenge, claimBytes, 2).put("permit", permit.getString("permit")))
        require(claim.getString("execution") == "android_owned_reminder" && claim.getInt("action_revision") == 3)
        val claimId = ReminderVault.id(claim.getString("claim_id"))
        val expiry = claim.getDouble("expires_at")
        require(expiry.isFinite() && expiry > System.currentTimeMillis() / 1000.0 && expiry <= System.currentTimeMillis() / 1000.0 + 20)
        val monotonicExpiry = SystemClock.elapsedRealtime() + (expiry * 1000 - System.currentTimeMillis()).toLong().coerceIn(0, 15000)
        onMain {
          active(ticket); binding(origin, user, installation)
          check(System.currentTimeMillis() / 1000.0 < expiry && SystemClock.elapsedRealtime() < monotonicExpiry)
          synchronized(ReminderVault.lock) {
            when (kind) {
              "create" -> {
                check(ReminderAlarms.allowed(context()) && requireNotNull(resolved).occurrences.first() > System.currentTimeMillis())
                val row = requireNotNull(selected)
                check(vault.read(requireNotNull(selectedOwner), row.id) == row)
                ReminderAlarms.schedule(context(), row)
                vault.save(requireNotNull(selectedOwner), row, row.copy(state = "scheduled", revision = row.revision + 1))
                outcome = "schedule_requested"
              }
              "cancel" -> {
                val row = requireNotNull(selected)
                vault.save(requireNotNull(selectedOwner), row, row.copy(state = "cancelled", revision = row.revision + 1, body = null))
                ReminderAlarms.cancel(context(), row.id)
                outcome = "reminder_cancelled"
              }
              "storage" -> outcome = "storage_updated" // Server change commits only with the signed receipt.
              else -> outcome = "saved_copy_deleted"
            }
          }
        }
        val result = JSONObject().put("expected_revision", 3).put("claim_id", claimId).put("outcome", outcome)
        optionalReceiptOrCopy {
          val receiptChallenge = request("/receipt-challenge", result)
          val receiptBytes = envelope(receiptChallenge, "receipt", 3)
          val fields = JSONObject(receiptBytes)
          require(fields.getString("claim_id") == claimId && fields.getString("outcome") == outcome)
          val receipt = request("/receipt", result.put("challenge_id", receiptChallenge.getString("challenge_id"))
            .put("signature", sign(installation, receiptBytes)))
          require(receipt.getString("state") == outcome && receipt.getString("task_id") == taskId)
          recorded = true
        }
        if (kind in setOf("storage", "delete_saved") && !recorded) outcome = "outcome_unknown"
        if (outcome == "schedule_requested" && settings.getString("mode") == "account") {
          copyState = "unavailable"
          if (recorded) optionalReceiptOrCopy {
            onMain { active(ticket); binding(origin, user, installation) }
            val copied = protocol.post(origin, token, "/stored/save", JSONObject().put("task_id", taskId).put("salt", salt)
              .put("payload_json", payload), ticket, deadline)
            require(copied.getString("reminder_id") == id && copied.getBoolean("stored"))
            copyState = "stored"
          }
        }
      }
    } catch (error: Exception) {
      if (error is NativeControlRejected && error.status == 401) { runCatching { clear() }; throw error }
      outcome = if (claimed) "outcome_unknown" else if (ticket != generation.get()) "cancelled" else "failed"
    }
    return JSONObject().put("protocol_version", 1).put("outcome", outcome).put("reminder_id", id ?: JSONObject.NULL)
      .put("receipt_recorded", recorded).put("account_copy", copyState).toString()
  }
  fun saveCopy(origin: String, user: String, installation: String, management: String, id: String, ticket: Long): String {
    val token = session(origin, user, installation, management, ticket)
    check(storage(origin, token, ticket).getString("mode") == "account")
    val vault = ReminderVault(context())
    val rowAndBody = onMain {
      active(ticket)
      val selectedOwner = requireNotNull(owner(vault, origin, user, installation))
      val row = vault.read(selectedOwner, ReminderVault.id(id))
      check(row.state == "scheduled")
      row to vault.privateBody(selectedOwner, row)
    }
    val payload = rowAndBody.second.getString("payload_json")
    val title = JSONObject(payload).getString("title")
    check(confirm("Save an encrypted account copy of:\n$title\n\nIts title and schedule will be sent to your configured HTTPS server, not to Gemini.", System.currentTimeMillis() / 1000.0 + 60, ticket))
    onMain { active(ticket); binding(origin, user, installation) }
    val result = wire().post(origin, token, "/stored/save", JSONObject().put("task_id", rowAndBody.first.task)
      .put("payload_json", payload).put("salt", rowAndBody.second.getString("salt")), ticket, SystemClock.elapsedRealtime() + 15000)
    onMain { active(ticket); binding(origin, user, installation) }
    return result.toString()
  }
  fun clear() { cancel(); ReminderVault(context()).clear { ReminderAlarms.cancel(context(), it) } }
}
