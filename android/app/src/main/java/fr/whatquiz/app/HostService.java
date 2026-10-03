package fr.whatquiz.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Service de premier plan pendant qu'une partie tourne sur cet appareil (le professeur anime depuis l'application) :
 * Android ne met pas l'application en sommeil et ne la ferme pas si le professeur passe sur une autre application
 * (ou affiche la partie ailleurs), et les élèves restent connectés. Une notification l'indique tant que la partie dure.
 */
public class HostService extends Service {
    private static final String CHANNEL_ID = "host";
    private static final int NOTIFICATION_ID = 1;

    /** Démarre le service ; sans effet (et sans erreur) si Android le refuse. */
    static void start(Context context) {
        Intent intent = new Intent(context, HostService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException ignored) {
            // Démarrage refusé (application déjà en arrière-plan) : la partie continue tant que l'écran reste ouvert.
        }
    }

    static void stop(Context context) {
        try {
            context.stopService(new Intent(context, HostService.class));
        } catch (RuntimeException ignored) {
            // Déjà arrêté.
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            Notification notification = buildNotification();
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (RuntimeException e) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private Notification buildNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null && manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Partie en cours", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Affichée pendant qu'une partie tourne sur cet appareil");
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
        return builder
                .setSmallIcon(R.drawable.ic_stat_host)
                .setContentTitle("Partie WhatQuiz en cours")
                .setContentText("La partie tourne sur cet appareil : gardez l'application ouverte jusqu'à la fin.")
                .setContentIntent(content)
                .setOngoing(true)
                .setShowWhen(false)
                .build();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Application balayée depuis les applis récentes : la partie est terminée, la notification disparaît.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
