package ai.contexify.platform

import android.app.Activity
import android.app.AlertDialog
import android.app.KeyguardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.ContactsContract
import android.provider.Telephony
import android.telecom.TelecomManager
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest
import org.json.JSONException
import org.json.JSONObject

/** OS pickers/composers only. No CALL_PHONE, SEND_SMS, READ_CONTACTS or networking. */
class AssistantPlatformModule : Module() {
  private data class Target(val component: ComponentName, val version: Long, val updated: Long, val signers: List<String>)
  private data class Request(val id: String, val promise: Promise, val picker: Boolean, val code: Int, val deadline: Long)
  private val handler = Handler(Looper.getMainLooper())
  private var request: Request? = null
  private var dialog: AlertDialog? = null
  private var timeout: Runnable? = null
  private var codes = 0x4c00
  private fun context(): Context = requireNotNull(appContext.reactContext)
  @Suppress("DEPRECATION")
  private fun enabled(): Boolean = context().packageName == "ai.contexify.app.assistantvolumetest" &&
    context().packageManager.getApplicationInfo(context().packageName, PackageManager.GET_META_DATA)
      .metaData?.getBoolean("ai.contexify.assistant.EXECUTION_ENABLED", false) == true
  private fun foreground(): Activity {
    check(enabled())
    val activity = requireNotNull(appContext.currentActivity)
    val keyguard = context().getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    check(!keyguard.isDeviceLocked && !activity.isFinishing && !activity.isDestroyed &&
      (activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true)
    return activity
  }
  private fun intent(draft: CommunicationDraft) = if (draft.kind == "dial")
    Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", draft.number, null))
    else Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", draft.number, null)).putExtra("sms_body", draft.body)
  @Suppress("DEPRECATION")
  private fun target(draft: CommunicationDraft): Target {
    val manager = context().packageManager
    val packageId = if (draft.kind == "dial")
      (context().getSystemService(Context.TELECOM_SERVICE) as TelecomManager).defaultDialerPackage
      else Telephony.Sms.getDefaultSmsPackage(context())
    check(!packageId.isNullOrEmpty())
    val component = requireNotNull(manager.resolveActivity(intent(draft).setPackage(packageId), PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo)
    check(component.packageName == packageId && component.exported && component.enabled && component.applicationInfo.enabled)
    val info = manager.getPackageInfo(packageId, if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES)
    val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
    val signers = requireNotNull(signatures).map { signature -> MessageDigest.getInstance("SHA-256")
      .digest(signature.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) } }.sorted()
    check(signers.isNotEmpty())
    return Target(ComponentName(packageId, component.name),
      if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong(), info.lastUpdateTime, signers)
  }
  private fun finish(result: Any, closePicker: Boolean = false) {
    val current = request ?: return
    request = null
    timeout?.let { handler.removeCallbacks(it) }; timeout = null
    dialog?.setOnDismissListener(null); dialog?.dismiss(); dialog = null
    if (closePicker && current.picker) {
      @Suppress("DEPRECATION")
      try { appContext.currentActivity?.finishActivity(current.code) } catch (_: RuntimeException) { /* The activity may already be gone. */ }
    }
    current.promise.resolve(result)
  }
  private fun cancel(id: String? = null) {
    val current = request ?: return
    if (id != null && current.id != id) return
    finish(if (current.picker) mapOf("outcome" to "outcome_unknown", "number" to null) else "outcome_unknown", true)
  }
  private fun begin(id: String, promise: Promise, picker: Boolean, expiresAt: Double? = null): Request {
    foreground()
    require(id.matches(Regex("communication-[0-9]+-[0-9]+")) && id.length <= 100)
    check(request == null)
    // Never reuse a picker request code in this process: ignore late activity results.
    check(codes < 0x7fff)
    val remaining = expiresAt?.let {
      require(it.isFinite())
      val left = it - System.currentTimeMillis().toDouble()
      require(left > 0 && left <= 185000)
      minOf(60000.0, left).toLong().coerceAtLeast(1)
    } ?: 60000L
    val current = Request(id, promise, picker, ++codes, SystemClock.elapsedRealtime() + remaining)
    request = current
    timeout = Runnable { if (request === current) cancel(current.id) }.also { handler.postDelayed(it, remaining) }
    return current
  }
  private fun selected(current: Request, uri: Uri, attempts: Int = 0) {
    if (request !== current || SystemClock.elapsedRealtime() >= current.deadline) return
    // onActivityResult may precede onResume. Never read/return private data while locked/backgrounded.
    if (runCatching { foreground() }.isFailure) {
      if (attempts < 10) handler.postDelayed({ selected(current, uri, attempts + 1) }, 100)
      else cancel(current.id)
      return
    }
    try {
      require(uri.scheme == "content" && uri.authority == ContactsContract.AUTHORITY &&
        context().contentResolver.getType(uri) == ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
      val number = context().contentResolver.query(uri, arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER), null, null, null)?.use { cursor ->
        require(cursor.moveToFirst())
        cursor.getString(0)
      }
      require(number != null && number.length in 1..64 && number.matches(Regex("[+0-9 ()-]+")))
      finish(mapOf("outcome" to "selected", "number" to number))
    } catch (_: RuntimeException) { cancel(current.id) }
  }
  private fun open(id: String, encoded: String, promise: Promise, expiresAt: Double? = null) {
      try {
        require(encoded.toByteArray(Charsets.UTF_8).size <= 8192)
        val json = JSONObject(encoded)
        require(json.keys().asSequence().toSet() == setOf("kind", "number", "body"))
        require(listOf("kind", "number", "body").all { json.get(it) is String })
        val draft = CommunicationDraft(json.getString("kind"), json.getString("number"), json.getString("body"))
        val destination = target(draft)
        val current = begin(id, promise, false, expiresAt)
        dialog = AlertDialog.Builder(foreground()).setTitle(if (draft.kind == "dial") "Open phone request?" else "Open message composer?")
          .setMessage("Number: ${draft.number}\n" + (if (draft.kind == "sms") "\nMessage:\n${draft.body}\n" else "") +
            "\nApp: ${destination.component.packageName}\n\nReview again in the phone app and tap Call or Send yourself. Charges may apply. The phone app may retain this information; Contexify sign-out cannot remove it.")
          .setNegativeButton("Cancel") { _, _ -> if (request === current) finish("cancelled") }
          .setPositiveButton("Open") { _, _ ->
            if (request === current) {
              try {
                val activity = foreground()
                check(SystemClock.elapsedRealtime() < current.deadline && target(draft) == destination)
                activity.startActivity(intent(draft).setComponent(destination.component))
                finish("handoff_requested")
              } catch (_: RuntimeException) { finish("outcome_unknown") }
            }
          }.create().also { popup ->
            popup.setOnDismissListener { if (request === current) finish("cancelled") }
            popup.setCanceledOnTouchOutside(false)
            popup.show()
          }
      } catch (_: JSONException) {
        promise.reject("ERR_COMMUNICATION_INPUT", "Review the number and message.", null)
      } catch (_: RuntimeException) {
        if (request?.id == id) cancel(id)
        else promise.reject("ERR_COMMUNICATION_UNAVAILABLE", "Request unavailable. Review the number and default Phone or Messages app.", null)
      }
  }
  override fun definition() = ModuleDefinition {
    Name("AssistantPlatform")
    OnActivityEntersBackground { if (request?.picker != true) cancel() }
    OnActivityDestroys { cancel() }
    OnDestroy { handler.post { cancel() } }
    OnActivityResult { _, result ->
      val current = request
      if (current != null && current.picker && current.code == result.requestCode) {
        val uri = result.data?.data
        if (result.resultCode == Activity.RESULT_CANCELED)
          finish(mapOf("outcome" to "cancelled", "number" to null))
        else if (result.resultCode == Activity.RESULT_OK && uri != null) selected(current, uri)
        else cancel(current.id)
      }
    }
    AsyncFunction("communicationSupport") { ->
      val active = runCatching { foreground() }.isSuccess
      fun can(kind: String) = active && runCatching { target(CommunicationDraft(kind, "+12025550123", if (kind == "sms") "test" else "")) }.isSuccess
      mapOf("picker" to (active && context().packageManager.resolveActivity(Intent(Intent.ACTION_PICK).setType(ContactsContract.CommonDataKinds.Phone.CONTENT_TYPE), PackageManager.MATCH_DEFAULT_ONLY) != null),
        "dial" to can("dial"), "sms" to can("sms"))
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("pickPhoneNumber") { id: String, promise: Promise ->
      try {
        val current = begin(id, promise, true)
        @Suppress("DEPRECATION")
        foreground().startActivityForResult(Intent(Intent.ACTION_PICK).setType(ContactsContract.CommonDataKinds.Phone.CONTENT_TYPE), current.code)
      } catch (_: RuntimeException) {
        if (request?.id == id) cancel(id)
        else promise.reject("ERR_CONTACT_PICKER", "Contact picker unavailable. Enter a number manually.", null)
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("openCommunication") { id: String, encoded: String, promise: Promise ->
      open(id, encoded, promise)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("openPlannedCommunication") { id: String, encoded: String, expiresAt: Double, promise: Promise ->
      open(id, encoded, promise, expiresAt)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("cancelCommunicationRequest") { id: String -> cancel(id) }.runOnQueue(Queues.MAIN)
  }
}
