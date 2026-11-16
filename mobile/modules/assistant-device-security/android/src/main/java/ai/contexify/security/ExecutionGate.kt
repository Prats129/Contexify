package ai.contexify.security

import android.content.Context
import android.content.pm.PackageManager

/** Binary opt-in only. Each executor must still validate its own permission and exact action. */
internal object ExecutionGate {
  fun requireEnabled(context: Context) {
    @Suppress("DEPRECATION")
    val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
    check(info.metaData?.getBoolean("ai.contexify.assistant.EXECUTION_ENABLED", false) == true)
    check(!context.packageName.endsWith(".assistantverification"))
  }
}
