package ai.annadata.plugin.capacitor;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.AlarmClock;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.github.ningloke.ling.PlannerFiles;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Calendar;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

@CapacitorPlugin(name = "LocalModel")
public class LocalModelPlugin extends Plugin {
    public static final String MODEL = "Qwen3-1.7B-Q4_K_M.gguf";
    public static final long MODEL_SIZE = 1107409472L;
    private static final String HASH = "b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897";
    private static final String URL = "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/" + MODEL;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private long verifiedTime = -1;

    private File modelFile() { return new File(getContext().getExternalFilesDir(null), "models/" + MODEL); }
    private DownloadManager downloads() { return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE); }
    private android.content.SharedPreferences prefs() { return getContext().getSharedPreferences("local-model", Context.MODE_PRIVATE); }
    private boolean verifyModel() throws Exception {
        File file = modelFile();
        if (!file.isFile() || file.length() != MODEL_SIZE) return false;
        if (verifiedTime == file.lastModified()) return true;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[128 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) digest.update(buffer, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        if (!HASH.equals(hex.toString())) throw new Exception("模型校验失败，请重新下载");
        verifiedTime = file.lastModified();
        return true;
    }

    @PluginMethod
    public void status(PluginCall call) {
        worker.execute(() -> {
            try {
                JSObject result = new JSObject();
                result.put("model", MODEL);
                result.put("size", MODEL_SIZE);
                if (verifyModel()) { result.put("state", "ready"); call.resolve(result); return; }
                long id = prefs().getLong("download", -1);
                try (Cursor cursor = downloads().query(new DownloadManager.Query().setFilterById(id))) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        result.put("downloaded", cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)));
                        result.put("state", status == DownloadManager.STATUS_FAILED || status == DownloadManager.STATUS_SUCCESSFUL ? "failed" : "downloading");
                        result.put("reason", cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)));
                    } else result.put("state", "missing");
                }
                call.resolve(result);
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        worker.execute(() -> {
            try {
                if (verifyModel()) { call.resolve(); return; }
            } catch (Exception ignored) { /* Replace a corrupt model, never user planner data. */ }
            try {
                long id = prefs().getLong("download", -1);
                try (Cursor cursor = downloads().query(new DownloadManager.Query().setFilterById(id))) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        if (status == DownloadManager.STATUS_PENDING || status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PAUSED) { call.resolve(); return; }
                    }
                }
                if (id != -1) downloads().remove(id);
                File file = modelFile();
                if (file.exists() && !file.delete()) throw new Exception("旧模型无法移除，请检查储存空间");
                if (getContext().getExternalFilesDir(null).getUsableSpace() < MODEL_SIZE + 128 * 1024 * 1024L) throw new Exception("请先留出至少 1.3GB 储存空间");
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(URL))
                    .setTitle("Ling 本地管家模型（约 1.1GB）")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalFilesDir(getContext(), "models", MODEL);
                prefs().edit().putLong("download", downloads().enqueue(request)).apply();
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }

    @PluginMethod
    public void infer(PluginCall call) {
        String prompt = call.getString("prompt", "");
        if (prompt.isEmpty() || prompt.length() > 6500) { call.reject("指令太长，请用 JSON 文件分批导入"); return; }
        worker.execute(() -> {
            LlamaCpp engine = null;
            try {
                if (!verifyModel()) throw new Exception("请先在设置里下载本地管家模型");
                engine = new LlamaCpp(getContext());
                JSObject params = new JSObject();
                params.put("model", modelFile().getAbsolutePath());
                params.put("n_ctx", 4096);
                params.put("n_batch", 256);
                final boolean[] initialized = { false };
                engine.initContext(1, params, result -> {
                    if (result.isSuccess()) initialized[0] = true;
                    else call.reject(result.getError().getMessage());
                });
                if (!initialized[0]) return;
                JSObject completion = new JSObject();
                completion.put("prompt", prompt);
                completion.put("n_predict", 700);
                completion.put("temperature", 0.0);
                engine.completion(1, completion, result -> {
                    if (result.isSuccess()) {
                        JSObject out = new JSObject();
                        out.put("text", String.valueOf(result.getData().get("text")));
                        call.resolve(out);
                    } else call.reject(result.getError().getMessage());
                });
            } catch (LinkageError error) { call.reject("此设备无法加载 ARM64 模型运行库：" + error.getMessage()); }
            catch (Exception error) { call.reject(error.getMessage(), error); }
            finally { if (engine != null) engine.releaseAllContexts(result -> {}); }
        });
    }

    @PluginMethod
    public void pickFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        startActivityForResult(call, intent, "pickedFile");
    }
    @ActivityCallback
    private void pickedFile(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) { call.resolve(); return; }
        Uri uri = result.getData().getData();
        worker.execute(() -> {
            try {
                String name = "download.txt";
                try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = cursor.getString(cursor.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME));
                }
                try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                    call.resolve(filesResult(name, PlannerFiles.readBounded(in, PlannerFiles.LIMIT)));
                }
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    public static JSObject filesResult(String name, byte[] bytes) throws Exception {
        JSArray files = new JSArray();
        for (PlannerFiles.TextFile file : PlannerFiles.read(name, bytes)) {
            JSObject f = new JSObject(); f.put("name", file.name); f.put("text", file.text); files.put(f);
        }
        JSObject result = new JSObject(); result.put("files", files); return result;
    }

    @PluginMethod
    public void clock(PluginCall call) {
        Double value = call.getDouble("when");
        String title = call.getString("title", "");
        if (value == null || !Double.isFinite(value) || title.isEmpty() || title.length() > 200) { call.reject("闹钟内容不对"); return; }
        long when = value.longValue();
        if (!clockTimeSupported(when, System.currentTimeMillis())) { call.reject("系统时钟只支持下一次这个时间；较远日期请用 App 通知提醒"); return; }
        Calendar target = Calendar.getInstance(); target.setTimeInMillis(when);
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM)
                    .putExtra(AlarmClock.EXTRA_HOUR, target.get(Calendar.HOUR_OF_DAY))
                    .putExtra(AlarmClock.EXTRA_MINUTES, target.get(Calendar.MINUTE))
                    .putExtra(AlarmClock.EXTRA_MESSAGE, title)
                    .putExtra(AlarmClock.EXTRA_SKIP_UI, false);
                getActivity().startActivity(intent);
                call.resolve();
            } catch (Exception error) { call.reject("手机没有可用的时钟 App", error); }
        });
    }
    static boolean clockTimeSupported(long when, long now) {
        Calendar target = Calendar.getInstance(); target.setTimeInMillis(when);
        Calendar next = Calendar.getInstance(); next.setTimeInMillis(now);
        next.set(Calendar.HOUR_OF_DAY, target.get(Calendar.HOUR_OF_DAY));
        next.set(Calendar.MINUTE, target.get(Calendar.MINUTE)); next.set(Calendar.SECOND, 0); next.set(Calendar.MILLISECOND, 0);
        if (next.getTimeInMillis() <= now) next.add(Calendar.DAY_OF_MONTH, 1);
        // shortcut: Android Clock intents cannot specify a calendar date; use app notifications beyond the next occurrence.
        return when > now && Math.abs(next.getTimeInMillis() - when) < 60000;
    }
    @Override protected void handleOnDestroy() { worker.shutdown(); }
}
