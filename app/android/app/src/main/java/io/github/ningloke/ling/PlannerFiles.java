package io.github.ningloke.ling;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Read only, never extract archive paths to disk. The same limits apply to picker and ChatGPT downloads. */
public final class PlannerFiles {
    public static final int LIMIT = 512 * 1024;
    public static final class TextFile {
        public final String name, text;
        TextFile(String name, byte[] bytes) throws IOException {
            this.name = name;
            this.text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString();
        }
    }
    public static byte[] readBounded(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int n;
        while ((n = input.read(buffer)) != -1) {
            if (out.size() + n > limit) throw new IOException("文件太大：每次最多 512KB");
            out.write(buffer, 0, n);
        }
        return out.toByteArray();
    }
    public static boolean supported(String name) {
        return name != null && name.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(json|ics|txt|zip)$");
    }
    public static List<TextFile> read(String name, byte[] data) throws IOException {
        if (!supported(name) || data.length > LIMIT) throw new IOException("请下载或选择 JSON、ICS、TXT 或 ZIP 文件（最多 512KB）");
        List<TextFile> files = new ArrayList<>();
        if (!name.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")) {
            files.add(new TextFile(name, data));
            return files;
        }
        int total = 0, count = 0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(data), StandardCharsets.UTF_8)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++count > 20) throw new IOException("ZIP 每次最多 20 个项目");
                String path = entry.getName().replace('\\', '/');
                if (path.startsWith("/") || path.matches(".*(?:^|/)\\.\\.(?:/|$).*") || path.contains(":")) throw new IOException("ZIP 路径不安全");
                byte[] bytes = readBounded(zip, LIMIT - total);
                total += bytes.length;
                if (entry.isDirectory()) continue;
                if (!supported(path) || path.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")) throw new IOException("ZIP 只能包含 JSON、ICS 和 TXT 文件");
                files.add(new TextFile(path, bytes));
            }
        }
        if (files.isEmpty()) throw new IOException("ZIP 没有可导入的文件");
        return files;
    }
}
