package io.github.ningloke.ling;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public class PlannerFilesTest {
    private byte[] zip(String path, byte[] content) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes)) {
            zip.putNextEntry(new ZipEntry(path)); zip.write(content); zip.closeEntry();
        }
        return bytes.toByteArray();
    }
    @Test public void textAndArchivesRetainChineseAndNeverExtractPaths() throws Exception {
        byte[] text = "明天健身".getBytes(StandardCharsets.UTF_8);
        assertEquals("明天健身", PlannerFiles.read("安排.TXT", text).get(0).text);
        assertEquals("明天健身", PlannerFiles.read("安排.zip", zip("folder/安排.txt", text)).get(0).text);
    }
    @Test public void rejectsTraversalBinaryNestedArchivesAndInvalidUtf8() throws Exception {
        for (String path : new String[] { "../x.txt", "folder/../../x.txt", "/x.txt", "C:/x.txt", "file.exe", "file.zip" }) {
            try { PlannerFiles.read("x.zip", zip(path, new byte[] { 65 })); fail(path); }
            catch (java.io.IOException expected) {}
        }
        try { PlannerFiles.read("x.txt", new byte[] { (byte) 0xff }); fail(); }
        catch (java.io.IOException expected) {}
    }
    @Test public void boundsCompressedAndDecompressedFiles() throws Exception {
        byte[] large = new byte[PlannerFiles.LIMIT + 1];
        try { PlannerFiles.read("x.zip", zip("x.txt", large)); fail(); }
        catch (java.io.IOException expected) {}
        try { PlannerFiles.readBounded(new ByteArrayInputStream(large), PlannerFiles.LIMIT); fail(); }
        catch (java.io.IOException expected) {}
    }
}
