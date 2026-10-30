// 안드로이드 알림 읽기 서비스 (SMS3) — 문자 앱 두 개와 판매자가 고른 은행 앱의 알림만 연다.
// 다른 앱 알림은 패키지 이름만 보고 내용(extras)을 열지 않은 채 버린다.
// 시스템이 서비스를 붙이면(앱 설치·재부팅·허용 직후) 떠 있는 알림을 한 번 훑어 꺼져 있던 동안 온 것을 이어받는다(본 열쇠로 두 번 막기).
package com.livejjim.notice

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import java.util.concurrent.Executors

class NoticeListenerService : NotificationListenerService() {
  override fun onListenerConnected() {
    super.onListenerConnected()
    val store = NoticeStore.get(this)
    store.connected = true
    NoticeBus.changed(this)
    // 재부팅·서비스가 떨어졌던 동안 떠 있는 알림을 이어받는다
    val active: Array<StatusBarNotification> = try {
      activeNotifications ?: emptyArray()
    } catch (_: Exception) {
      emptyArray()
    }
    for (sbn in active) handle(sbn)
    NoticeSender.kick(this)
  }

  override fun onListenerDisconnected() {
    NoticeStore.get(this).connected = false
    NoticeBus.changed(this)
    if (NoticeStore.get(this).isEnabled() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      requestRebind(ComponentName(this, NoticeListenerService::class.java))
    }
    super.onListenerDisconnected()
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn != null) handle(sbn)
  }

  private fun handle(sbn: StatusBarNotification) {
    // 허용 밖 앱은 패키지 이름만 보고 버린다 — 알림 내용을 열지 않는다
    val packageName = sbn.packageName ?: return
    val store = NoticeStore.get(this)
    if (!store.isAllowed(packageName)) return
    if (!store.isEnabled()) return
    val raw = try {
      NotificationReader.read(sbn)
    } catch (_: Exception) {
      return
    }
    NoticeIntake.submit(applicationContext, raw)
  }
}

/** 알림 → 날것 (허용한 앱의 알림만 여기로 온다) */
internal object NotificationReader {
  fun read(sbn: StatusBarNotification): RawNotice {
    val n = sbn.notification
    val extras = n.extras
    val style = try {
      NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)
    } catch (_: Exception) {
      null
    }
    val messages = style?.let { s ->
      val user = s.user
      s.messages.map { m ->
        val person = m.person
        RawMessage(m.timestamp, person?.name?.toString(), person?.uri, m.text?.toString(), isUser(person, user))
      }
    }
    return RawNotice(
      packageName = sbn.packageName,
      whenMs = n.`when`,
      postTimeMs = sbn.postTime,
      title = extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
      text = extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
      bigText = extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString(),
      messages = messages,
      groupSummary = (n.flags and Notification.FLAG_GROUP_SUMMARY) != 0,
      ongoing = (n.flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_FOREGROUND_SERVICE)) != 0,
    )
  }

  /** 메시지 스타일에서 사람이 없으면 휴대폰 주인이 보낸 것이다. 주인과 열쇠가 같아도 */
  private fun isUser(person: Person?, user: Person): Boolean {
    if (person == null) return true
    if (person.key != null) return person.key == user.key
    if (person.uri != null) return person.uri == user.uri
    return user.key == null && user.uri == null && person.name?.toString() == user.name?.toString()
  }
}

/** 꺼내기 → 거르기 → 두 번 막기 → 암호화 대기열 → 보내기. 알림 스레드를 붙잡지 않게 한 줄 일꾼에서 돈다 */
internal object NoticeIntake {
  private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "livejjim-notice-intake") }

  fun submit(context: Context, raw: RawNotice) {
    executor.execute {
      try {
        val store = NoticeStore.get(context)
        if (!store.isEnabled()) return@execute
        val result = NoticeExtractor.extract(raw, store.enabledAtMs())
        var queued = 0
        val rules = store.rules()
        for (candidate in result.candidates) {
          if (NoticeFilter.match(rules, candidate.kindHint, candidate.source, candidate.body) != null) {
            store.bump("filtered")
            continue
          }
          if (store.enqueue(candidate, System.currentTimeMillis()) == "queued") queued++
        }
        NoticeBus.changed(context)
        if (queued > 0) NoticeSender.kick(context)
      } catch (_: Exception) {
        // 한 알림의 실패가 서비스를 멈추지 않게 (내용은 기록하지 않는다)
      }
    }
  }
}

/** 알림 읽기 허용·배터리 최적화 */
internal object NoticeAccess {
  fun isGranted(context: Context): Boolean = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

  /** 배터리 최적화 대상이면 true (뒤에서 늦거나 멈출 수 있다) */
  fun batteryOptimized(context: Context): Boolean? {
    val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return null
    return !power.isIgnoringBatteryOptimizations(context.packageName)
  }
}

/** 상태가 바뀌면 모듈이 JS에 알린다 */
internal object NoticeBus {
  @Volatile var listener: ((Context) -> Unit)? = null
  fun changed(context: Context) {
    try {
      listener?.invoke(context.applicationContext)
    } catch (_: Exception) {
      // 모듈이 사라지는 중
    }
  }
}
