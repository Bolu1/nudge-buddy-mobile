package expo.modules.voiceengine

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Android counterpart of the iOS Live Activities: an ongoing notification with
 * a live chronometer (focus countdown, call duration…). On Android 16+ it asks
 * to be promoted to a "Live Update" — the status-bar chip.
 */
object LiveUpdates {
  private const val CHANNEL_ID = "nudge_live_updates"
  // Stable ids per kind so updates replace the same notification
  private val IDS = mapOf("focus" to 4720, "reminder" to 4721, "block" to 4722, "call" to 4723)
  // EXTRA_REQUEST_PROMOTED_ONGOING (API 36), by key so it compiles against older SDKs
  private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"

  fun show(
    context: Context,
    scheme: String,
    kind: String,
    title: String,
    text: String,
    startEpoch: Double?,
    endEpoch: Double?,
    paused: Boolean,
    colorHex: String,
  ) {
    ensureChannel(context)
    val id = IDS[kind] ?: return
    val path = when (kind) { "focus" -> "focus"; "block" -> "workday"; else -> "workspace" }
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("$scheme://$path")).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pending = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val color = try { Color.parseColor(colorHex) } catch (_: Exception) { Color.parseColor("#8da38a") }

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(text)
      .setColor(color)
      .setColorized(true)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(if (kind == "call") NotificationCompat.CATEGORY_CALL else NotificationCompat.CATEGORY_PROGRESS)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setContentIntent(pending)

    when {
      paused -> builder.setShowWhen(false)
      endEpoch != null && endEpoch * 1000 > System.currentTimeMillis() -> {
        builder.setWhen((endEpoch * 1000).toLong()).setUsesChronometer(true).setChronometerCountDown(true).setShowWhen(true)
        if (startEpoch != null && endEpoch > startEpoch) {
          val total = ((endEpoch - startEpoch)).toInt()
          val done = ((System.currentTimeMillis() / 1000.0) - startEpoch).toInt().coerceIn(0, total)
          builder.setProgress(total, done, false)
        }
      }
      startEpoch != null -> builder.setWhen((startEpoch * 1000).toLong()).setUsesChronometer(true).setShowWhen(true)
      else -> builder.setShowWhen(false)
    }
    builder.extras.putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true)

    try {
      NotificationManagerCompat.from(context).notify(id, builder.build())
    } catch (e: SecurityException) {
      Log.w("VoiceEngine", "notification permission missing", e)
    }
  }

  fun clear(context: Context, kind: String) {
    val id = IDS[kind] ?: return
    NotificationManagerCompat.from(context).cancel(id)
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Live status", NotificationManager.IMPORTANCE_DEFAULT).apply {
      description = "Focus timer, upcoming reminder and workday block"
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    }
    nm.createNotificationChannel(channel)
  }
}
