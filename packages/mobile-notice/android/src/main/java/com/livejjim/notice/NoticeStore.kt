// 문자찜·입금 알림 받기의 기기 저장 (SMS3).
// - 대기열: 알림 한 건 = 파일 하나, 안드로이드 Keystore AES-256-GCM으로 암호화(전화번호·본문이 평문으로 남지 않는다).
//   noBackupFilesDir에 두어 클라우드 백업에 실리지 않는다. 파일 이름 = 받은 시각(15자리) + localId → 이름 순서 = 받은 차례.
// - 기기 토큰·보낼 곳: 같은 키로 암호화한 파일 하나(토큰은 로그·설정 글에 남기지 않는다).
// - 본 열쇠(localId): 같은 알림 두 번 막기 — 최근 5,000개를 noBackup 파일에 둔다(지문이라 비밀이 아니다).
// - 켬/끔·은행 앱·거르기 규칙·건수: SharedPreferences (비밀 없음).
// 재부팅 뒤에도 모두 남아, 서비스가 다시 붙거나 WorkManager가 돌면 이어서 보낸다.
package com.livejjim.notice

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONObject

/** Keystore AES-256-GCM. 키는 기기 밖으로 나가지 않는다 */
internal object NoticeCrypto {
  private const val KEYSTORE = "AndroidKeyStore"
  private const val ALIAS = "livejjim_notice_v1"
  private const val TRANSFORM = "AES/GCM/NoPadding"
  private const val IV_BYTES = 12
  private const val TAG_BITS = 128

  @Synchronized
  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (keyStore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    return generator.generateKey()
  }

  /** 앞 12바이트 IV + 암호문. purpose는 덧붙인 인증 자료(대기열 글을 토큰 자리에 바꿔 넣지 못하게) */
  fun encrypt(plain: ByteArray, purpose: String): ByteArray {
    val cipher = Cipher.getInstance(TRANSFORM)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    cipher.updateAAD(purpose.toByteArray(Charsets.UTF_8))
    val sealed = cipher.doFinal(plain)
    return cipher.iv + sealed
  }

  /** 풀지 못하면 null (키가 바뀜·파일 깨짐) */
  fun decrypt(blob: ByteArray, purpose: String): ByteArray? {
    if (blob.size <= IV_BYTES) return null
    return try {
      val cipher = Cipher.getInstance(TRANSFORM)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, blob, 0, IV_BYTES))
      cipher.updateAAD(purpose.toByteArray(Charsets.UTF_8))
      cipher.doFinal(blob, IV_BYTES, blob.size - IV_BYTES)
    } catch (_: Exception) {
      null
    }
  }
}

internal data class TokenConfig(val token: String, val endpoint: String, val deviceId: String)

internal class NoticeStore private constructor(context: Context) {
  companion object {
    const val QUEUE_MAX = 5_000
    const val SEEN_MAX = 5_000
    private const val PREFS = "livejjim_notice"
    private const val PURPOSE_QUEUE = "livejjim-notice-queue"
    private const val PURPOSE_TOKEN = "livejjim-notice-token"
    val COUNTERS = listOf("sent", "filtered", "duplicates", "rejected", "dropped")

    @Volatile private var instance: NoticeStore? = null
    fun get(context: Context): NoticeStore =
      instance ?: synchronized(this) { instance ?: NoticeStore(context.applicationContext).also { instance = it } }
  }

  private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private val dir = File(context.noBackupFilesDir, "livejjim-notice")
  private val queueDir = File(dir, "queue")
  private val seenFile = File(dir, "seen.txt")
  private val tokenFile = File(dir, "token.bin")
  private val lock = Any()
  private var seen: LinkedHashSet<String>? = null
  @Volatile private var allowed: Set<String>? = null
  @Volatile private var rulesCache: List<FilterRule>? = null

  /** 시스템이 알림 읽기 서비스를 붙였는가 (서비스와 모듈이 같은 프로세스) */
  @Volatile var connected: Boolean = false

  // ── 켬/끔 ──
  fun isEnabled(): Boolean = prefs.getBoolean("enabled", false)
  fun enabledAtMs(): Long = prefs.getLong("enabledAtMs", 0L)
  fun setEnabled(enabled: Boolean, nowMs: Long) {
    val editor = prefs.edit().putBoolean("enabled", enabled)
    if (enabled && !isEnabled()) editor.putLong("enabledAtMs", nowMs)
    editor.apply()
  }

  // ── 허용한 앱 ──
  fun bankPackages(): List<String> {
    val text = prefs.getString("bankPackages", null) ?: return emptyList()
    return try {
      val array = JSONArray(text)
      (0 until array.length()).mapNotNull { array.opt(it) as? String }
    } catch (_: Exception) {
      emptyList()
    }
  }
  fun setBankPackages(packages: List<String>) {
    prefs.edit().putString("bankPackages", JSONArray(packages).toString()).apply()
    allowed = null
  }
  /** 패키지 이름만 본다 — 허용 밖이면 알림 내용을 열지 않는다 */
  fun isAllowed(packageName: String): Boolean {
    val set = allowed ?: (NoticeExtractor.SMS_PACKAGES + bankPackages()).toSet().also { allowed = it }
    return set.contains(packageName)
  }

  // ── 거르기 규칙 ──
  fun rules(): List<FilterRule> {
    rulesCache?.let { return it }
    val json = prefs.getString("rulesJson", null)
    val parsed = if (json == null) null else NoticeFilter.parse(json)
    return (parsed ?: NoticeFilter.DEFAULT_RULES).also { rulesCache = it }
  }
  fun serverRules(): Boolean = prefs.getString("rulesJson", null)?.let { NoticeFilter.parse(it) } != null
  /** 빈 글·틀린 글이면 기본 규칙으로 */
  fun setRulesJson(json: String) {
    val parsed = if (json.isEmpty()) null else NoticeFilter.parse(json)
    if (parsed == null) prefs.edit().remove("rulesJson").apply() else prefs.edit().putString("rulesJson", json).apply()
    rulesCache = null
  }

  // ── 기기 토큰 ──
  fun hasToken(): Boolean = tokenFile.exists()
  fun token(): TokenConfig? {
    synchronized(lock) {
      if (!tokenFile.exists()) return null
      val plain = NoticeCrypto.decrypt(tokenFile.readBytes(), PURPOSE_TOKEN) ?: return null
      return try {
        val o = JSONObject(String(plain, Charsets.UTF_8))
        TokenConfig(o.getString("token"), o.getString("endpoint"), o.getString("deviceId"))
      } catch (_: Exception) {
        null
      }
    }
  }
  fun setToken(config: TokenConfig?) {
    synchronized(lock) {
      if (config == null) {
        tokenFile.delete()
      } else {
        dir.mkdirs()
        val plain = JSONObject().put("token", config.token).put("endpoint", config.endpoint).put("deviceId", config.deviceId).toString()
        writeAtomic(tokenFile, NoticeCrypto.encrypt(plain.toByteArray(Charsets.UTF_8), PURPOSE_TOKEN))
      }
      prefs.edit().putBoolean("tokenRejected", false).apply()
      if (lastError() == "TOKEN") setLastError(null)
    }
  }
  fun isTokenRejected(): Boolean = prefs.getBoolean("tokenRejected", false)
  fun setTokenRejected() {
    prefs.edit().putBoolean("tokenRejected", true).putString("lastError", "TOKEN").apply()
  }

  // ── 건수·마지막 ──
  fun bump(counter: String) {
    synchronized(lock) { prefs.edit().putLong("count_$counter", prefs.getLong("count_$counter", 0L) + 1).apply() }
  }
  fun count(counter: String): Long = prefs.getLong("count_$counter", 0L)
  fun lastError(): String? = prefs.getString("lastError", null)
  fun setLastError(value: String?) {
    if (value == null) prefs.edit().remove("lastError").apply() else prefs.edit().putString("lastError", value).apply()
  }
  fun markSent(nowMs: Long) {
    prefs.edit().putLong("lastSentAtMs", nowMs).remove("lastError").apply()
  }

  // ── 대기열 ──
  /** 두 번 막기·넘침 검사 뒤 암호화해 넣는다: queued · duplicate · dropped */
  fun enqueue(candidate: NoticeCandidate, nowMs: Long): String {
    synchronized(lock) {
      val seenSet = loadSeen()
      if (seenSet.contains(candidate.localId)) {
        bump("duplicates")
        return "duplicate"
      }
      queueDir.mkdirs()
      if ((queueDir.list()?.size ?: 0) >= QUEUE_MAX) {
        bump("dropped")
        return "dropped"
      }
      val name = "${candidate.receivedAtMs.coerceAtLeast(0L).toString().padStart(15, '0')}-${candidate.localId}.q"
      val sealed = NoticeCrypto.encrypt(NoticeContract.candidateJson(candidate).toByteArray(Charsets.UTF_8), PURPOSE_QUEUE)
      writeAtomic(File(queueDir, name), sealed)
      rememberSeen(seenSet, candidate.localId)
      prefs.edit().putLong("lastQueuedAtMs", nowMs).apply()
      return "queued"
    }
  }

  /** 받은 차례대로 (파일 이름 순) */
  fun pendingFiles(): List<File> = (queueDir.listFiles { f -> f.name.endsWith(".q") } ?: emptyArray()).sortedBy { it.name }
  fun pendingCount(): Int = queueDir.list { _, name -> name.endsWith(".q") }?.size ?: 0

  /** 풀지 못한 파일은 지우고 넘침 건수로 센다(키가 바뀐 경우 — 다시 보낼 수 없다) */
  fun read(file: File): NoticeCandidate? {
    val plain = try {
      NoticeCrypto.decrypt(file.readBytes(), PURPOSE_QUEUE)
    } catch (_: Exception) {
      null
    }
    if (plain == null) {
      if (file.exists()) {
        file.delete()
        bump("dropped")
      }
      return null
    }
    return try {
      val o = JSONObject(String(plain, Charsets.UTF_8))
      NoticeCandidate(o.getString("kindHint"), o.getString("sourceType"), o.getString("source"), o.getString("body"), o.getLong("receivedAtMs"), o.getString("localId"))
    } catch (_: Exception) {
      file.delete()
      bump("dropped")
      null
    }
  }

  fun remove(file: File) {
    file.delete()
  }

  private fun loadSeen(): LinkedHashSet<String> {
    seen?.let { return it }
    val set = LinkedHashSet<String>()
    if (seenFile.exists()) seenFile.forEachLine { line -> if (line.length == 32) set.add(line) }
    seen = set
    return set
  }

  private fun rememberSeen(set: LinkedHashSet<String>, id: String) {
    set.add(id)
    dir.mkdirs()
    if (set.size > SEEN_MAX) {
      val keep = set.toList().takeLast(SEEN_MAX)
      set.clear()
      set.addAll(keep)
      writeAtomic(seenFile, keep.joinToString("\n", postfix = "\n").toByteArray(Charsets.UTF_8))
    } else {
      seenFile.appendText("$id\n")
    }
  }

  private fun writeAtomic(target: File, bytes: ByteArray) {
    val tmp = File(target.parentFile, "${target.name}.tmp")
    tmp.writeBytes(bytes)
    if (!tmp.renameTo(target)) {
      target.delete()
      tmp.renameTo(target)
    }
  }

  /** JS에 넘기는 상태 (null 칸은 넣지 않는다 — JS가 null로 본다) */
  fun stateMap(context: Context): Map<String, Any> {
    val map = mutableMapOf<String, Any>(
      "platform" to "android",
      "enabled" to isEnabled(),
      "access" to if (NoticeAccess.isGranted(context)) "granted" else "needed",
      "connected" to connected,
      "hasToken" to hasToken(),
      "tokenRejected" to isTokenRejected(),
      "pending" to pendingCount(),
      "bankPackages" to bankPackages(),
      "serverRules" to serverRules(),
    )
    for (counter in COUNTERS) map[counter] = count(counter).toDouble()
    prefs.getLong("lastQueuedAtMs", 0L).takeIf { it > 0 }?.let { map["lastQueuedAtMs"] = it.toDouble() }
    prefs.getLong("lastSentAtMs", 0L).takeIf { it > 0 }?.let { map["lastSentAtMs"] = it.toDouble() }
    lastError()?.let { map["lastError"] = it }
    NoticeAccess.batteryOptimized(context)?.let { map["batteryOptimized"] = it }
    return map
  }
}
