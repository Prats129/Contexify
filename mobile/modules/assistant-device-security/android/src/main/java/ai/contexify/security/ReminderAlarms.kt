package ai.contexify.security

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import java.security.SecureRandom
import android.util.Base64

internal object ReminderAlarms {
  const val CHANNEL = "contexify_owned_reminders_v1"
  private const val ACTION = "ai.contexify.assistant.OWNED_REMINDER"
  private const val GRACE = ReminderDeliveryPolicy.GRACE_MILLIS
  fun nonce() = Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING)
  private fun intent(context: Context, id: String) = Intent(context, ReminderAlarmReceiver::class.java)
    .setAction(ACTION).setData(Uri.parse("contexify-owned-reminder://alert/${ReminderVault.id(id)}"))
  fun allowed(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 26) return false
    if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
    val manager = context.getSystemService(NotificationManager::class.java)
    return manager.areNotificationsEnabled() && manager.getNotificationChannel(CHANNEL)?.importance?.let { it != NotificationManager.IMPORTANCE_NONE } == true
  }
  fun channel(context: Context) {
    check(Build.VERSION.SDK_INT >= 26)
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Contexify reminders", NotificationManager.IMPORTANCE_DEFAULT).apply {
      description = "Generic alerts for reminders you approve. Open Contexify to view private details."
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    })
  }
  fun schedule(context: Context, row: ReminderEntry) {
    check(Build.VERSION.SDK_INT >= 26 && row.state in setOf("schedule_unknown", "scheduled"))
    val pending = PendingIntent.getBroadcast(context, 0, intent(context, row.id).putExtra("nonce", row.nonce),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    // Deliberately inexact: no exact-alarm special access, wake lock or foreground service.
    context.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,
      maxOf(System.currentTimeMillis() + 1000, row.times[row.index]), pending)
  }
  fun cancel(context: Context, id: String) {
    val pending = PendingIntent.getBroadcast(context, 0, intent(context, id), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
    if (pending != null) { context.getSystemService(AlarmManager::class.java).cancel(pending); pending.cancel() }
    context.getSystemService(NotificationManager::class.java).cancel("assistant-reminder:$id", 0)
  }
  private fun notify(context: Context, id: String) {
    check(allowed(context))
    val generic = Notification.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setContentTitle("Contexify reminder").setContentText("Open Contexify to view your reminders.")
      .setCategory(Notification.CATEGORY_REMINDER).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE)
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
      // This is only our own launcher and contains no private reminder payload.
      generic.setContentIntent(PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    }
    context.getSystemService(NotificationManager::class.java).notify("assistant-reminder:$id", 0, generic.build())
  }
  fun fire(context: Context, id: String, nonce: String) = synchronized(ReminderVault.lock) {
    ExecutionGate.requireEnabled(context)
    val vault = ReminderVault(context)
    val owner = vault.owner() ?: return@synchronized
    val row = vault.read(owner, ReminderVault.id(id))
    val now = System.currentTimeMillis()
    when (ReminderDeliveryPolicy.due(row, now, nonce, allowed(context))) {
      ReminderDeliveryPolicy.Due.IGNORE -> return@synchronized
      ReminderDeliveryPolicy.Due.REQUEUE -> { schedule(context, row); return@synchronized }
      ReminderDeliveryPolicy.Due.MISSED -> {
        vault.save(owner, row, row.copy(state = "missed", revision = row.revision + 1, lastOutcome = "missed"))
        cancel(context, id); return@synchronized
      }
      ReminderDeliveryPolicy.Due.BLOCKED -> {
        vault.save(owner, row, row.copy(state = "blocked", revision = row.revision + 1, lastOutcome = "blocked"))
        cancel(context, id); return@synchronized
      }
      ReminderDeliveryPolicy.Due.NOTIFY -> Unit
    }
    // A crash after this write is unknown. Never repost an uncertain occurrence.
    val uncertain = row.copy(state = "notification_unknown", revision = row.revision + 1)
    vault.save(owner, row, uncertain)
    notify(context, id)
    val nextIndex = ReminderDeliveryPolicy.next(row, now)
    if (nextIndex == null) {
      vault.save(owner, uncertain, uncertain.copy(state = "notification_requested", revision = uncertain.revision + 1,
        lastOutcome = "notification_requested"))
    } else {
      val pending = uncertain.copy(index = nextIndex, state = "schedule_unknown", nonce = ReminderAlarms.nonce(),
        revision = uncertain.revision + 1, lastOutcome = "notification_requested")
      vault.save(owner, uncertain, pending)
      schedule(context, pending)
      vault.save(owner, pending, pending.copy(state = "scheduled", revision = pending.revision + 1))
    }
  }
  fun reconcile(context: Context) = synchronized(ReminderVault.lock) {
    if (Build.VERSION.SDK_INT < 26) return@synchronized
    ExecutionGate.requireEnabled(context)
    val vault = ReminderVault(context)
    val owner = vault.owner() ?: return@synchronized
    vault.prune(owner).forEach { cancel(context, it) }
    for (id in vault.ids()) {
      // Corrupt/unknown records cannot cause a new delivery. No text key is opened.
      val row = runCatching { vault.read(owner, id) }.getOrNull() ?: continue
      if (row.state != "scheduled") continue
      if (System.currentTimeMillis() > row.times[row.index] + GRACE) {
        vault.save(owner, row, row.copy(state = "missed", revision = row.revision + 1, lastOutcome = "missed"))
        cancel(context, id)
      } else schedule(context, row) // Only the previously approved immutable occurrence.
    }
  }
  fun isAlarm(intent: Intent): Boolean = intent.action == ACTION && intent.data?.scheme == "contexify-owned-reminder" && intent.data?.host == "alert"
}

/** Non-exported explicit PendingIntent target. No server, model, title or microphone use. */
class ReminderAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (Build.VERSION.SDK_INT < 26 || !ReminderAlarms.isAlarm(intent)) return
    val id = intent.data?.lastPathSegment ?: return
    val nonce = intent.getStringExtra("nonce") ?: return
    if (nonce.length != 43) return
    val pending = goAsync()
    kotlin.concurrent.thread(name = "ContexifyReminder", isDaemon = true) {
      try { ReminderAlarms.fire(context.applicationContext, id, nonce) }
      catch (_: Exception) { /* Fail closed. Never log private records or retry an unknown alert. */ }
      finally { pending.finish() }
    }
  }
}

/** Credential-encrypted data is used only after first unlock; no Direct Boot payload. */
class ReminderRescheduleReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (Build.VERSION.SDK_INT < 26 || intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
        Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED)) return
    val pending = goAsync()
    kotlin.concurrent.thread(name = "ContexifyReminderRestore", isDaemon = true) {
      try { ReminderAlarms.reconcile(context.applicationContext) }
      catch (_: Exception) { /* No resurrection when a key, owner or record is unavailable. */ }
      finally { pending.finish() }
    }
  }
}
