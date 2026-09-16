import android.app.RemoteInput;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.os.IBinder;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// KakaoTalk 알림 빠른답장(RemoteInput)으로 메시지를 보낸다. Iris(ye-seola/go-kdb, party.qwer.iris)의
// 기법을 최소 재구현: NotificationActionService로 REPLY_MESSAGE 인텐트를 IActivityManager.startService에
// reflection으로 던진다. su root app_process로 실행해야 한다.
public class KakaoReply {
    public static void main(String[] args) throws Exception {
        long chatId = Long.parseLong(args[0]);
        String msg = new String(Base64.getDecoder().decode(args[1]), StandardCharsets.UTF_8);
        String referer = readReferer();

        Intent intent = new Intent();
        intent.setComponent(new ComponentName(
                "com.kakao.talk", "com.kakao.talk.notification.NotificationActionService"));
        intent.putExtra("noti_referer", referer);
        intent.putExtra("chat_id", chatId);
        intent.putExtra("is_chat_thread_notification", false);
        intent.setAction("com.kakao.talk.notification.REPLY_MESSAGE");

        Bundle results = new Bundle();
        results.putCharSequence("reply_message", msg);
        RemoteInput remoteInput = new RemoteInput.Builder("reply_message").build();
        RemoteInput.addResultsToIntent(new RemoteInput[]{remoteInput}, intent, results);

        startService(intent);
        System.out.println("OK chat_id=" + chatId + " referer=" + (referer.isEmpty() ? "(empty)" : "set"));
    }

    private static void startService(Intent intent) throws Exception {
        Class<?> stub = Class.forName("android.app.IActivityManager$Stub");
        Class<?> iam = Class.forName("android.app.IActivityManager");
        Class<?> iAppThread = Class.forName("android.app.IApplicationThread");
        Object am = stub.getMethod("asInterface", IBinder.class).invoke(null, getService("activity"));

        try {
            Method m = iam.getMethod("startService", iAppThread, Intent.class, String.class,
                    boolean.class, String.class, String.class, int.class);
            m.invoke(am, null, intent, null, false, "com.android.shell", null, -3);
            return;
        } catch (NoSuchMethodException ignored) {
        }
        Method m = iam.getMethod("startService", iAppThread, Intent.class, String.class,
                boolean.class, String.class, int.class);
        m.invoke(am, null, intent, null, false, "com.android.shell", -3);
    }

    private static IBinder getService(String name) throws Exception {
        return (IBinder) Class.forName("android.os.ServiceManager")
                .getMethod("getService", String.class).invoke(null, name);
    }

    private static String readReferer() throws Exception {
        File f = new File("/data/data/com.kakao.talk/shared_prefs/KakaoTalk.hw.perferences.xml");
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
        }
        Matcher m = Pattern.compile("<string name=\"NotificationReferer\">(.*?)</string>").matcher(sb.toString());
        return m.find() ? m.group(1) : "";
    }
}
