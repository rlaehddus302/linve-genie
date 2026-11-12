package kr.livegenie.printstation

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PrintStationModule : Module() {
  private var requested = false

  override fun definition() = ModuleDefinition {
    Name("LiveGeniePrintStation")
    Events("stationStopped")
    OnCreate {
      PrintStationService.onEnded = { sendEvent("stationStopped") }
    }
    Function("setStation") { enabled: Boolean ->
      requested = enabled
      applyRequest()
    }
    Function("isRunning") { PrintStationService.running }
    OnActivityEntersForeground { if (requested) applyRequest() }
    OnDestroy {
      requested = false
      applyRequest()
      PrintStationService.onEnded = null
    }
  }

  private fun applyRequest() {
    val ctx = appContext.reactContext ?: return
    val intent = Intent(ctx, PrintStationService::class.java)
    if (!requested) {
      ctx.stopService(intent)
      return
    }
    if (PrintStationService.running || appContext.currentActivity == null) return
    if (Build.VERSION.SDK_INT >= 31 &&
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) return
    try {
      ContextCompat.startForegroundService(ctx, intent)
    } catch (_: IllegalStateException) {
      // Android can reject a start during the transition to background. Retry on foreground.
    } catch (_: SecurityException) {
      // The user may have revoked Nearby devices permission mid-transition.
    }
  }
}
