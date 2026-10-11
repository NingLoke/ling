package ai.annadata.plugin.capacitor;

import org.junit.Test;
import static org.junit.Assert.*;
import java.time.Instant;

public class LocalModelTest {
    @Test public void clockOnlyAcceptsTheNextOccurrenceInDeviceTimezone() {
        long now = Instant.parse("2026-10-11T14:00:00Z").toEpochMilli();
        assertTrue(LocalModelPlugin.clockTimeSupported(now + 60 * 60 * 1000, now));
        assertTrue(LocalModelPlugin.clockTimeSupported(now + 12 * 60 * 60 * 1000, now));
        assertFalse(LocalModelPlugin.clockTimeSupported(now - 60 * 1000, now));
        assertFalse(LocalModelPlugin.clockTimeSupported(now + 25 * 60 * 60 * 1000, now));
        assertFalse(LocalModelPlugin.clockTimeSupported(now + 48 * 60 * 60 * 1000, now));
    }
}
