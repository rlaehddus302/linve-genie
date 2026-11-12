package kr.livegenie.printstation

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class PrintStationService : HeadlessJsTaskService() {
  companion object {
    @Volatile var running = false
    @Volatile var onEnded: (() -> Unit)? = null
    private const val CHANNEL = "livegenie_printer"
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (running) return START_NOT_STICKY
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "라벨 프린터", NotificationManager.IMPORTANCE_LOW))
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("라이브지니 · 라벨 프린터")
      .setContentText("이 휴대폰에서 찜 라벨을 출력하고 있어요.")
      .setOngoing(true).setSilent(true)
    if (launch != null) {
      notification.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    if (Build.VERSION.SDK_INT >= 29) startForeground(7102, notification.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    else startForeground(7102, notification.build())
    running = true
    // The existing queue and BLE driver use JS timers. Allow the same JS runtime
    // to finish their protocol timeouts and retries when the Activity is paused.
    startTask(HeadlessJsTaskConfig("LiveGeniePrintStation", Arguments.createMap(), 0, true))
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    onEnded?.invoke()
    super.onDestroy()
  }
}
