import { commandsFromJson, commandsFromIcs, commandsFromModel, prepareCommands, modelPrompt, alarmTime, MAX_FILE_BYTES } from "./planner-admin.js?v=d64ede6233";
import { parseCommand, describe } from "./planner-parse.js?v=4523820e4f";

export function createAdmin({ planner, getNow, openModal, toast, native = window.Capacitor?.isNativePlatform?.(), invoke = (plugin, method, data = {}) => window.Capacitor.nativePromise(plugin, method, data) }) {
  if (!native) return { enabled: false };
  const $ = (id) => document.getElementById(id);
  $("admin-settings").hidden = false;
  $("admin-mode").hidden = false;
  let enabled = false, busy = false, refreshTimer, reviewResolve, reviewApproved = false;
  let queue = Promise.resolve();
  const snapshot = () => Object.fromEntries(["events", "todos", "habits"].map((kind) => [kind, planner.items(kind)]));
  const setMessage = (message) => { $("admin-status").textContent = message; };
  const enqueue = (job) => {
    queue = queue.then(async () => {
      busy = true;
      $("admin-run").disabled = true;
      try { return await job(); }
      catch (error) { setMessage(error.message || "处理失败，请重试"); toast(error.message || "处理失败，请重试"); }
      finally { busy = false; $("admin-run").disabled = false; }
    });
    return queue;
  };
  $("admin-mode").addEventListener("click", () => {
    enabled = !enabled;
    $("admin-mode").textContent = enabled ? "管家" : "GPT";
    $("admin-mode").setAttribute("aria-pressed", String(enabled));
    $("ai-input").placeholder = enabled ? "让管家加任务、改日程或设闹钟" : "问 ChatGPT，或加日程";
    toast(enabled ? "本地管家：文字在手机上理解；新增可撤销，删除和修改先确认" : "已切回 ChatGPT");
  });

  async function refreshModel() {
    clearTimeout(refreshTimer);
    if (busy) return;
    try {
      const result = await invoke("LocalModel", "status");
      const ready = result.state === "ready", downloading = result.state === "downloading";
      $("admin-model-status").textContent = ready ? "模型已校验，可离线使用" : downloading ? `正在下载 ${Math.floor((result.downloaded || 0) / result.size * 100)}% · 可退出 App，下载会继续` : result.state === "failed" ? "下载失败，可点重新下载" : "Qwen3-1.7B · 约 1.1GB，首次下载后离线使用";
      $("admin-download").disabled = ready || downloading;
      $("admin-download").textContent = ready ? "已下载" : downloading ? "下载中" : "下载 / 重试";
      if (downloading) refreshTimer = setTimeout(refreshModel, 4000);
    } catch (error) { $("admin-model-status").textContent = error.message; $("admin-download").disabled = false; }
  }
  $("admin-download").addEventListener("click", async () => {
    $("admin-download").disabled = true;
    try { await invoke("LocalModel", "download"); await refreshModel(); }
    catch (error) { $("admin-model-status").textContent = error.message; $("admin-download").disabled = false; }
  });
  new MutationObserver(() => { if ($("plan-settings").open) refreshModel(); }).observe($("plan-settings"), { attributes: true, attributeFilter: ["open"] });

  async function notificationPermission(request = false) {
    let permission = await invoke("LocalNotifications", "checkPermissions");
    if (request && permission.display !== "granted") permission = await invoke("LocalNotifications", "requestPermissions");
    if (permission.display !== "granted") throw new Error("请先允许 App 通知，才能设置提醒");
    const exact = await invoke("LocalNotifications", "checkExactNotificationSetting");
    if (exact.exact_alarm !== "granted") throw new Error("请在设置里点「允许准时提醒」，开启闹钟与提醒权限");
  }
  $("admin-permission").addEventListener("click", async () => {
    try {
      const p = await invoke("LocalNotifications", "requestPermissions");
      if (p.display !== "granted") throw new Error("通知权限还没允许");
      const exact = await invoke("LocalNotifications", "checkExactNotificationSetting");
      if (exact.exact_alarm !== "granted") await invoke("LocalNotifications", "changeExactNotificationSetting");
      else toast("通知和准时提醒权限已开启");
    } catch (error) { toast(error.message); }
  });

  const review = $("admin-review");
  review.addEventListener("close", () => {
    const resolve = reviewResolve, approved = reviewApproved;
    reviewResolve = null; reviewApproved = false;
    if (!resolve) return;
    // Finish the existing dialog/history close before the queue can open another review.
    if (history.state?.adminReview) window.addEventListener("popstate", () => resolve(approved), { once: true });
    else resolve(approved);
  });
  $("admin-cancel").addEventListener("click", () => review.close());
  $("admin-approve").addEventListener("click", () => {
    reviewApproved = true; review.close();
  });
  function confirmBatch(commands) {
    $("admin-review-list").replaceChildren(...commands.map((c) => {
      const li = document.createElement("li");
      li.textContent = c.action === "alarm" ? `提醒：${c.date} ${String(Math.floor(c.time / 60)).padStart(2, "0")}:${String(c.time % 60).padStart(2, "0")} ${c.title}` :
        `${{ add: "新增", update: "修改", delete: "删除" }[c.action]}：${c.old ? c.old.title + " → " : ""}${c.item.title} · ${describe(c.kind, c.item)}`;
      return li;
    }));
    return new Promise((resolve) => { reviewResolve = resolve; openModal(review, "adminReview"); });
  }

  async function perform(raw) {
    const commands = prepareCommands(raw, snapshot());
    const clocks = commands.filter((c) => c.action === "alarm" && c.mode !== "notification");
    if (clocks.length > 1) throw new Error("系统时钟闹钟请逐个设置；批量提醒请用 mode:notification");
    if (commands.some((c) => c.action === "delete" || c.action === "update") && !await confirmBatch(commands)) {
      setMessage("已取消，这批资料没有修改"); return;
    }
    const alarms = commands.filter((c) => c.action === "alarm");
    if (alarms.some((c) => c.mode !== "clock")) await notificationPermission(true);
    const pending = alarms.some((c) => c.mode !== "clock") ? (await invoke("LocalNotifications", "getPending")).notifications || [] : [];
    const ids = new Set(pending.map((n) => n.id));
    const notifications = [];
    for (const c of alarms) {
      if (c.mode === "clock") continue;
      const when = alarmTime(c);
      if ([...pending, ...notifications].some((n) => n.extra?.lingAdmin && n.extra.when === when && n.title === c.title)) continue;
      let id; do { id = Math.floor(Math.random() * 2000000000) + 1; } while (ids.has(id));
      ids.add(id);
      notifications.push({ id, title: c.title, body: "日程管家提醒", channelId: "planner-admin", schedule: { at: new Date(when).toISOString(), allowWhileIdle: true }, extra: { lingAdmin: true, when } });
    }
    // Validate and save planner data once. A failed save never reports success or reaches sync.
    const result = planner.applyAdminBatch(commands);
    let reminderResult = "";
    if (notifications.length) {
      try {
        await invoke("LocalNotifications", "createChannel", { id: "planner-admin", name: "日程管家提醒", importance: 4, visibility: 1 });
        await invoke("LocalNotifications", "schedule", { notifications });
        reminderResult = `；已排 ${notifications.length} 个通知提醒`;
      } catch (error) { reminderResult = `；提醒未设置：${error.message}`; }
    }
    if (clocks.length) {
      try { await invoke("LocalModel", "clock", { title: clocks[0].title, when: alarmTime(clocks[0]) }); reminderResult += "；闹钟已交给系统时钟，请核对"; }
      catch (error) { reminderResult += `；系统闹钟未设置：${error.message}`; }
    }
    const message = `已处理 ${result.count} 个项目${reminderResult || (alarms.length ? "；相同通知提醒已存在" : "")}`;
    setMessage(message);
    $("admin-undo").hidden = !result.added.length;
    const undo = () => {
      try { planner.undoAdminAdds(result.added); $("admin-undo").hidden = true; toast("已撤销本批新增；提醒仍保留，可在已排提醒里取消"); }
      catch (error) { toast(error.message); }
    };
    $("admin-undo").onclick = undo;
    toast(message, result.added.length ? undo : null);
  }

  async function understand(text) {
    const simple = !/闹钟|通知|提醒|改|移动|调整/.test(text) ? parseCommand(text, getNow().iso) : null;
    if (simple) return [simple.action === "delete" ? { ...simple, kind: findKind(simple) } : simple];
    setMessage("管家正在手机上理解文字…"); toast("管家正在离线理解…");
    const prompt = modelPrompt(text, getNow().iso, snapshot());
    return commandsFromModel((await invoke("LocalModel", "infer", { prompt })).text);
  }
  function findKind(command) {
    const kinds = ["events", "todos", "habits"].filter((kind) => planner.items(kind).some((x) => x.title === command.query && (!command.date || (x.date || x.due) === command.date)));
    if (kinds.length !== 1) throw new Error("没有找到唯一的项目，请写清标题和日期");
    return kinds[0];
  }
  function submit(text) { return enqueue(async () => perform(await understand(text))); }
  function importFiles(files) {
    return enqueue(async () => {
      if (!Array.isArray(files) || !files.length || files.length > 20) throw new Error("没有可导入的文件，或文件数量超过 20");
      let bytes = 0;
      const commands = [];
      for (const file of files) {
        if (typeof file.name !== "string" || typeof file.text !== "string") throw new Error("文件内容不对");
        bytes += new TextEncoder().encode(file.text).length;
        if (bytes > MAX_FILE_BYTES) throw new Error("安排文件每次最多 512KB");
        const text = file.text.replace(/^\uFEFF/, "").trim();
        if (/\.json$/i.test(file.name) || text.startsWith("{")) commands.push(...commandsFromJson(text));
        else if (/\.ics$/i.test(file.name) || text.startsWith("BEGIN:VCALENDAR")) commands.push(...commandsFromIcs(text));
        else if (/\.txt$/i.test(file.name)) commands.push(...await understand(text));
        else throw new Error("只支持 JSON、ICS 和 TXT");
      }
      await perform(commands);
    });
  }
  $("admin-run").addEventListener("click", () => { const text = $("admin-text").value.trim(); if (text) submit(text); });
  $("admin-import").addEventListener("click", async () => {
    try { const result = await invoke("LocalModel", "pickFile"); if (result.files) { $("plan-settings").close(); importFiles(result.files); } }
    catch (error) { toast(error.message); }
  });
  window.addEventListener("planner:import-files", ({ detail }) => { if (detail?.files) importFiles(detail.files); });
  $("admin-pending").addEventListener("click", async () => {
    try {
      const notifications = (await invoke("LocalNotifications", "getPending")).notifications?.filter((n) => n.extra?.lingAdmin) || [];
      const list = $("admin-pending-list"); list.replaceChildren();
      if (!notifications.length) list.textContent = "没有待触发的 App 提醒。系统闹钟请到时钟 App 查看。";
      for (const n of notifications) {
        const row = document.createElement("p"), button = document.createElement("button");
        row.textContent = `${n.title} · ${new Date(n.extra.when).toLocaleString("zh-CN", { timeZone: "Asia/Kuala_Lumpur" })} `;
        button.type = "button"; button.className = "mini-btn danger"; button.textContent = "取消提醒";
        button.onclick = async () => {
          if (!confirm(`取消「${n.title}」的通知提醒？`)) return;
          try { await invoke("LocalNotifications", "cancel", { notifications: [{ id: n.id }] }); row.remove(); toast("提醒已取消"); }
          catch (error) { toast(error.message); }
        };
        row.append(button); list.append(row);
      }
    } catch (error) { toast(error.message); }
  });
  return { get enabled() { return enabled; }, submit, importFiles, addFromLink: (command) => enqueue(() => perform([command])) };
}
