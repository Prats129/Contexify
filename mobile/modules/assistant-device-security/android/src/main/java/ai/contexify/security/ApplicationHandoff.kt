package ai.contexify.security

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.AlarmClock
import java.security.MessageDigest

internal data class ApplicationTarget(val applicationId: String, val packageId: String,
  val component: ComponentName, val version: Long, val updated: Long, val signers: List<String>)

/** Resolve every handler before ANY plan effect. No arbitrary intents, data, extras or grants. */
internal object ApplicationHandoff {
  @Suppress("DEPRECATION")
  private fun candidate(context: Context, application: String, target: String, action: String = Intent.ACTION_MAIN): ApplicationTarget? {
    require(ReviewedApplications.valid(application, target))
    require(action in setOf(Intent.ACTION_MAIN, AlarmClock.ACTION_SET_ALARM, AlarmClock.ACTION_SHOW_ALARMS))
    val manager = context.packageManager
    val query = Intent(action).setPackage(target)
    if (action == Intent.ACTION_MAIN) query.addCategory(Intent.CATEGORY_LAUNCHER)
    val launchers = manager.queryIntentActivities(query, 0).map { it.activityInfo }
      .filter { it.packageName == target && it.exported && it.enabled && it.applicationInfo.enabled }
    val component = if (action == Intent.ACTION_MAIN) manager.getLaunchIntentForPackage(target)?.component
      else manager.resolveActivity(query, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.let { ComponentName(it.packageName, it.name) }
    if (component == null) return null
    if (launchers.none { ComponentName(it.packageName, it.name) == component }) return null
    val info = manager.getPackageInfo(target, if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES)
    val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
    val signers = requireNotNull(signatures).map { signature ->
      MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
    }.sorted()
    check(signers.isNotEmpty())
    return ApplicationTarget(application, target, component,
      if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong(), info.lastUpdateTime, signers)
  }
  fun resolve(context: Context, application: String): ApplicationTarget {
    val candidates = requireNotNull(ReviewedApplications.packages[application]).mapNotNull { target ->
      try { candidate(context, application, target) } catch (_: PackageManager.NameNotFoundException) { null }
    }
    if (candidates.isEmpty()) throw ApplicationUnavailable("No reviewed launcher is available. Install the app or open it manually.")
    if (candidates.size != 1) throw ApplicationUnavailable("Multiple reviewed Clock apps are installed. Open the intended app manually.")
    return candidates.single()
  }
  fun launch(context: Context, activity: Activity, target: ApplicationTarget) {
    check(candidate(context, target.applicationId, target.packageId) == target) {
      "The reviewed app changed. Review a new request."
    }
    activity.startActivity(Intent.makeMainActivity(target.component))
    // The OS accepted a launcher request. This does not prove visibility, playback or delivery.
  }
  fun resolveClock(context: Context, action: String, selectedPackage: String?): ApplicationTarget {
    require(action in setOf(AlarmClock.ACTION_SET_ALARM, AlarmClock.ACTION_SHOW_ALARMS))
    val packages = requireNotNull(ReviewedApplications.packages["clock"])
    require(selectedPackage == null || selectedPackage in packages)
    val available = packages.filter { selectedPackage == null || selectedPackage == it }.mapNotNull {
      try { candidate(context, "clock", it, action) } catch (_: PackageManager.NameNotFoundException) { null }
    }
    if (available.isEmpty()) throw ApplicationUnavailable("The selected reviewed Clock app cannot handle this request. Choose another reviewed Clock or open Clock manually.")
    if (available.size != 1) throw ApplicationUnavailable("Multiple reviewed Clock apps are available. Select the Clock app explicitly.")
    return available.single()
  }
}
