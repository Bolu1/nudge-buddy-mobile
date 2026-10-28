package expo.modules.voiceengine

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person

/**
 * Android counterpart of CallKit's incoming-call screen: a ringing, full-screen
 * call notification. Answer opens the app on the `call` deep link, which starts
 * the voice session; Decline just dismisses it.
 */
object IncomingCall {
  private const val CHANNEL_ID = "nudge_incoming_call"
  private const val NOTIFICATION_ID = 4712
  const val ACTION_DECLINE = "expo.modules.voiceengine.DECLINE_CALL"
  const val EXTRA_CALL_ID = "callId"

  /** Set by VoiceEngineModule while JS is alive */
  var onDeclined: ((String) -> Unit)? = null

  fun show(context: Context, scheme: String, callId: String, title: String, body: String) {
    ensureChannel(context)
    val answerIntent = Intent(Intent.ACTION_VIEW, Uri.parse("$scheme://call?callId=${Uri.encode(callId)}&answer=1")).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val answer = PendingIntent.getActivity(
      context, 1, answerIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val declineIntent = Intent(context, DeclineCallReceiver::class.java).apply {
      action = ACTION_DECLINE
      putExtra(EXTRA_CALL_ID, callId)
    }
    val decline = PendingIntent.getBroadcast(
      context, 2, declineIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val caller = Person.Builder().setName(title).setImportant(true).build()

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(body)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setOngoing(true)
      .setAutoCancel(true)
      .setTimeoutAfter(45_000)
      .setFullScreenIntent(answer, true)
      .setContentIntent(answer)

    val notification = try {
      builder.setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer)).build()
    } catch (e: Exception) {
      Log.w("VoiceEngine", "CallStyle unavailable, falling back to actions", e)
      builder
        .addAction(0, "Decline", decline)
        .addAction(0, "Answer", answer)
        .build()
    }
    try {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    } catch (e: SecurityException) {
      Log.w("VoiceEngine", "notification permission missing", e)
    }
  }

  fun dismiss(context: Context) {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Calls from Nudge Buddy", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "When Nudge Buddy calls you about a reminder"
      setSound(
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      enableVibration(true)
      lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
    }
    nm.createNotificationChannel(channel)
  }
}

class DeclineCallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != IncomingCall.ACTION_DECLINE) return
    IncomingCall.dismiss(context)
    val callId = intent.getStringExtra(IncomingCall.EXTRA_CALL_ID) ?: return
    IncomingCall.onDeclined?.invoke(callId)
  }
}
