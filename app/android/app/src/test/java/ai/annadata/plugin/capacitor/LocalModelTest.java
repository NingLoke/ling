package ai.annadata.plugin.capacitor;

import org.junit.Test;
import static org.junit.Assert.*;
import java.time.Instant;
import android.app.DownloadManager;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

public class LocalModelTest {
    @Test public void preallocatedDownloadsAreNotHashedOrLoadedUntilSuccessful() throws Exception {
        File file = File.createTempFile("ling-model", ".gguf");
        try {
            byte[] completed = "GGUF completed model fixture".getBytes(StandardCharsets.UTF_8);
            String hash = hash(completed);
            try (RandomAccessFile partial = new RandomAccessFile(file, "rw")) { partial.setLength(completed.length); }
            for (int status : new int[] { DownloadManager.STATUS_PENDING, DownloadManager.STATUS_RUNNING, DownloadManager.STATUS_PAUSED, DownloadManager.STATUS_FAILED }) {
                assertFalse(LocalModelPlugin.verifyModelFile(file, completed.length, hash, status, -1));
                assertFalse(LocalModelPlugin.verifyModelFile(file, completed.length, hash, status, file.lastModified()));
            }
            Files.write(file.toPath(), completed);
            assertFalse(LocalModelPlugin.verifyModelFile(file, completed.length, hash, DownloadManager.STATUS_RUNNING, -1));
            assertTrue(LocalModelPlugin.verifyModelFile(file, completed.length, hash, DownloadManager.STATUS_SUCCESSFUL, -1));
            assertTrue(LocalModelPlugin.verifyModelFile(file, completed.length, hash, -1, -1));
        } finally { Files.deleteIfExists(file.toPath()); }
    }

    @Test public void completedFilesStillRequireTheExpectedSizeAndHash() throws Exception {
        File file = File.createTempFile("ling-model", ".gguf");
        try {
            byte[] expected = "GGUF good".getBytes(StandardCharsets.UTF_8);
            Files.write(file.toPath(), "GGUF bad!".getBytes(StandardCharsets.UTF_8));
            Exception error = assertThrows(Exception.class, () -> LocalModelPlugin.verifyModelFile(file, expected.length, hash(expected), DownloadManager.STATUS_SUCCESSFUL, -1));
            assertTrue(error.getMessage().contains("模型校验失败"));
            Files.write(file.toPath(), expected);
            assertFalse(LocalModelPlugin.verifyModelFile(file, expected.length + 1, hash(expected), DownloadManager.STATUS_SUCCESSFUL, -1));
            assertTrue(LocalModelPlugin.verifyModelFile(file, expected.length, hash(expected), DownloadManager.STATUS_SUCCESSFUL, file.lastModified()));
        } finally { Files.deleteIfExists(file.toPath()); }
    }

    private static String hash(byte[] value) throws Exception {
        StringBuilder result = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(value)) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }

    @Test public void clockOnlyAcceptsTheNextOccurrenceInDeviceTimezone() {
        long now = Instant.parse("2026-10-11T14:00:00Z").toEpochMilli();
        assertTrue(LocalModelPlugin.clockTimeSupported(now + 60 * 60 * 1000, now));
        assertTrue(LocalModelPlugin.clockTimeSupported(now + 12 * 60 * 60 * 1000, now));
        assertFalse(LocalModelPlugin.clockTimeSupported(now - 60 * 1000, now));
        assertFalse(LocalModelPlugin.clockTimeSupported(now + 25 * 60 * 60 * 1000, now));
        assertFalse(LocalModelPlugin.clockTimeSupported(now + 48 * 60 * 60 * 1000, now));
    }
}
