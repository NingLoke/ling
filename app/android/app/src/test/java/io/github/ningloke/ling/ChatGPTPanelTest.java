package io.github.ningloke.ling;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class ChatGPTPanelTest {
    @Test public void fileDownloadsStayOnSecureAttachmentHosts() {
        assertTrue(ChatGPTPanelPlugin.safeDownloadUrl("https://files.oaiusercontent.com/file.json?signature=x"));
        assertTrue(ChatGPTPanelPlugin.safeDownloadUrl("https://chatgpt.com/backend-api/file"));
        for (String url : new String[] { "http://files.oaiusercontent.com/a", "https://oaiusercontent.com.evil/a", "https://user@files.oaiusercontent.com/a", "https://files.oaiusercontent.com:444/a", "https://127.0.0.1/a" }) assertFalse(url, ChatGPTPanelPlugin.safeDownloadUrl(url));
    }
    @Test
    public void chatAndEmailLoginStayInThePanel() {
        for (String url : new String[] {
            "https://chatgpt.com/", "https://chatgpt.com/c/conversation?q=hello%20world",
            "https://auth.openai.com/log-in", "https://auth0.openai.com/u/login/password",
            "https://chat.openai.com/", "HTTPS://CHATGPT.COM:443/"
        }) assertTrue(url, ChatGPTPanelPlugin.isChatGPTUrl(url));
    }

    @Test
    public void untrustedOrInsecureNavigationCannotEnterThePanel() {
        for (String url : new String[] {
            "https://accounts.google.com/", "https://chatgpt.com.evil.example/",
            "https://evil.example/chatgpt.com", "https://evil.example@chatgpt.com/",
            "http://chatgpt.com/", "https://chatgpt.com:444/", "javascript:alert(1)",
            "file:///data/data/io.github.ningloke.ling/", "content://private", "", null
        }) assertFalse(String.valueOf(url), ChatGPTPanelPlugin.isChatGPTUrl(url));
    }

    @Test
    public void googleLoginUsesOnlyKnownSecureGoogleOrigins() {
        for (String url : new String[] {
            "https://accounts.google.com/", "https://accounts.google.com/o/oauth2/v2/auth",
            "HTTPS://ACCOUNTS.GOOGLE.COM:443/", "https://consent.google.com/",
            "https://myaccount.google.com/", "https://www.google.com/"
        }) assertTrue(url, ChatGPTPanelPlugin.isGoogleLoginUrl(url));
        for (String url : new String[] {
            "https://accounts.google.com.evil.example/", "https://evil.example/accounts.google.com",
            "https://evil.example@accounts.google.com/", "http://accounts.google.com/",
            "https://accounts.google.com:444/", "https://mail.google.com/",
            "https://google.com/", "https://www.google.com.evil.example/", null
        }) assertFalse(String.valueOf(url), ChatGPTPanelPlugin.isGoogleLoginUrl(url));
    }

    @Test
    public void plannerActionLinksReturnToTheAppOnlyOnItsKnownRoute() {
        for (String url : new String[] {
            "https://ningloke.github.io/ling/?add=event&title=Gym&date=2026-10-13&start=15%3A00",
            "https://NINGLOKE.GITHUB.IO:443/ling?title=Gym&add=todo",
            "https://ningloke.github.io/ling/?add=habit&title=Read"
        }) assertTrue(url, ChatGPTPanelPlugin.isPlannerActionUrl(url));
        for (String url : new String[] {
            "http://ningloke.github.io/ling/?add=event", "https://ningloke.github.io.evil/ling/?add=event",
            "https://ningloke.github.io/other/?add=event", "https://ningloke.github.io/ling/?add=delete",
            "https://ningloke.github.io/ling/?add=event:evil", "https://user@ningloke.github.io/ling/?add=todo",
            "https://ningloke.github.io:444/ling/?add=todo", null
        }) assertFalse(String.valueOf(url), ChatGPTPanelPlugin.isPlannerActionUrl(url));
    }

    @Test
    public void sheetGesturesAndBackStepThroughTheThreeLayouts() {
        assertEquals(2, ChatGPTPanelPlugin.modeAfterSwipe(1, -60, 48));
        assertEquals(1, ChatGPTPanelPlugin.modeAfterSwipe(2, 60, 48));
        assertEquals(0, ChatGPTPanelPlugin.modeAfterSwipe(1, 60, 48));
        assertEquals(2, ChatGPTPanelPlugin.modeAfterSwipe(1, 0, 48));
        assertEquals(1, ChatGPTPanelPlugin.modeAfterBack(2));
        assertEquals(0, ChatGPTPanelPlugin.modeAfterBack(1));
    }

    @Test
    public void keyboardGetsAFullHeightViewportAboveItsInset() {
        assertEquals(2400, ChatGPTPanelPlugin.panelHeight(2400, 1, true));
        assertEquals(1600, ChatGPTPanelPlugin.panelHeight(2400, 1, false));
        assertEquals(2160, ChatGPTPanelPlugin.panelHeight(2400, 2, false));
        assertEquals(900, ChatGPTPanelPlugin.bottomInset(80, 900, true));
        assertEquals(80, ChatGPTPanelPlugin.bottomInset(80, 900, false));
    }

    @Test
    public void chatBackgroundTracksPlannerLightAndDarkThemes() {
        String dark = ChatGPTPanelPlugin.chatThemeCss(false);
        String light = ChatGPTPanelPlugin.chatThemeCss(true);
        assertTrue(dark.contains("#0b0c10"));
        assertTrue(dark.contains("color-scheme:dark"));
        assertTrue(dark.contains("rgba(255,255,255,.18) 1px,transparent 1.2px"));
        assertTrue(dark.contains("opacity:.35;"));
        assertTrue(dark.contains("#planner-app-backdrop i:nth-child(1){left:-12%;top:34%;width:50vmin;height:50vmin;background:#2b8fff}"));
        assertTrue(dark.contains("opacity:.5}"));
        assertTrue(dark.contains("--sidebar-surface-primary:#15171e!important"));
        assertTrue(dark.contains("[role=menu],[role=dialog],[role=listbox],[data-radix-popper-content-wrapper]>*{background-color:#15171e!important"));
        assertTrue(dark.contains("--composer-surface:rgba(21,23,30,.72)!important"));
        assertTrue(dark.contains("form:has([contenteditable=\"true\"]),form:has(textarea){position:relative;z-index:10;background-color:rgba(21,23,30,.72)!important;"));
        assertTrue(dark.contains("body{position:relative;isolation:isolate;background-color:#0b0c10!important"));
        assertTrue(dark.contains("#planner-app-backdrop{position:fixed;inset:0;z-index:0;"));
        assertFalse(dark.contains("main [class*='bg-token-main-surface']"));
        assertTrue(light.contains("#e6e8ed"));
        assertTrue(light.contains("color-scheme:light"));
        assertTrue(light.contains("rgba(20,24,40,.12) 1px,transparent 1.2px"));
        assertTrue(light.contains("opacity:.2}"));
        assertTrue(light.contains("#planner-app-backdrop i:nth-child(3){left:22%;top:78%;width:44vmin;height:34vmin;background:#e06bff;opacity:.12}"));
        assertTrue(light.contains("--sidebar-surface-primary:#f3f4f7!important"));
        assertTrue(light.contains("[role=menu],[role=dialog],[role=listbox],[data-radix-popper-content-wrapper]>*{background-color:#f3f4f7!important"));
        assertTrue(light.contains("--composer-surface:rgba(243,244,247,.72)!important"));
        assertTrue(light.contains("form:has([contenteditable=\"true\"]),form:has(textarea){position:relative;z-index:10;background-color:rgba(243,244,247,.72)!important;"));
        assertTrue(light.contains("body{position:relative;isolation:isolate;background-color:#e6e8ed!important"));
    }
}
