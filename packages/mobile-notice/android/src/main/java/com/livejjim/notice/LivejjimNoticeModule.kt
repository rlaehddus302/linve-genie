// 문자찜·입금 알림 받기 모듈 (Expo Modules API, 이름 LivejjimNotice — SMS3).
// JS에 보이는 것: start · stop · getState · openSettings · setAllowedPackages · setToken · clearToken · setFilterRules · flush · 사건 "state".
// 알림을 읽고 보내는 일은 JS 없이 서비스·WorkManager가 한다. 이 모듈은 설정을 넣고 상태를 비출 뿐이다.
// JS(src/notice.ts)가 먼저 검사하지만 네이티브도 한 번 더 검사한다(토큰·주소·은행 앱).
package com.livejjim.notice

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.service.notification.NotificationListenerService
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class InvalidPackagesException : CodedException("E_INVALID_PACKAGES", "은행 앱 목록이 맞지 않아요", null)
class InvalidTokenException : CodedException("E_INVALID_TOKEN", "연결 정보가 맞지 않아요", null)

class LivejjimNoticeModule : Module() {
  private val context: Context get() = requireNotNull(appContext.reactContext) { "React context 없음" }.applicationContext

  override fun definition() = ModuleDefinition {
    Name("LivejjimNotice")
    Events("state")

    OnCreate {
      NoticeBus.listener = { ctx -> sendEvent("state", NoticeStore.get(ctx).stateMap(ctx)) }
    }

    OnDestroy {
      NoticeBus.listener = null
    }

    AsyncFunction("start") {
      val store = NoticeStore.get(context)
      store.setEnabled(true, System.currentTimeMillis())
      if (NoticeAccess.isGranted(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        NotificationListenerService.requestRebind(ComponentName(context, NoticeListenerService::class.java))
      }
      NoticeSender.kick(context)
      NoticeBus.changed(context)
      store.stateMap(context)
    }

    AsyncFunction("stop") {
      val store = NoticeStore.get(context)
      store.setEnabled(false, System.currentTimeMillis())
      NoticeBus.changed(context)
      store.stateMap(context)
    }

    AsyncFunction("getState") {
      NoticeStore.get(context).stateMap(context)
    }

    AsyncFunction("openSettings") { target: String ->
      openSettings(target)
    }

    AsyncFunction("setAllowedPackages") { packages: List<String> ->
      val cleaned = packages.map { it.trim() }.distinct()
      val ok = cleaned.size <= NoticeExtractor.BANK_PACKAGES_MAX &&
        cleaned.all { NoticeExtractor.PACKAGE_NAME.matches(it) && it.length <= 150 && !NoticeExtractor.BLOCKED_PACKAGES.contains(it) && !NoticeExtractor.SMS_PACKAGES.contains(it) }
      if (!ok) throw InvalidPackagesException()
      val store = NoticeStore.get(context)
      store.setBankPackages(cleaned)
      NoticeBus.changed(context)
      store.stateMap(context)
    }

    AsyncFunction("setToken") { token: String, endpoint: String, deviceId: String ->
      if (!NoticeContract.TOKEN_PATTERN.matches(token) || !NoticeContract.DEVICE_ID_PATTERN.matches(deviceId) || !NoticeContract.isAllowedEndpoint(endpoint)) {
        throw InvalidTokenException()
      }
      val store = NoticeStore.get(context)
      store.setToken(TokenConfig(token, endpoint, deviceId))
      NoticeSender.kick(context)
      NoticeBus.changed(context)
      store.stateMap(context)
    }

    AsyncFunction("clearToken") {
      val store = NoticeStore.get(context)
      store.setToken(null)
      NoticeBus.changed(context)
      store.stateMap(context)
    }

    AsyncFunction("setFilterRules") { rulesJson: String ->
      val store = NoticeStore.get(context)
      store.setRulesJson(rulesJson)
      NoticeBus.changed(context)
      store.stateMap(context)
    }

    AsyncFunction("flush") {
      val result = NoticeSender.drain(context) { false }
      NoticeSender.schedule(context, result)
      val map = mutableMapOf<String, Any>("sent" to result.sent, "pending" to result.pending)
      result.stoppedBy?.let { map["stoppedBy"] = it }
      map
    }
  }

  private fun openSettings(target: String): Boolean {
    val packageUri = Uri.fromParts("package", context.packageName, null)
    val intents: List<Intent> = when (target) {
      "notificationAccess" -> buildList {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          add(
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
              .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, ComponentName(context, NoticeListenerService::class.java).flattenToString()),
          )
        }
        add(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
      }
      "battery" -> listOf(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri))
      "app" -> listOf(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri))
      else -> emptyList()
    }
    val activity = appContext.currentActivity
    for (intent in intents) {
      try {
        if (activity != null) activity.startActivity(intent) else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
      } catch (_: ActivityNotFoundException) {
        continue
      } catch (_: SecurityException) {
        continue
      }
    }
    return false
  }
}
