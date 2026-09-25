import type { Plugin } from "@opencode-ai/plugin"

/**
 * Muse Spark fertig — Desktop + Handy Notification
 *
 * Erkennung: Zuverlässig via `event` Hook + `tool.execute.after` für `task`.
 * Kein Timer-Raten. Debounced (max 1x pro 30s pro Session).
 *
 * Ruft notification/notify.ps1 via PowerShell auf (WSL → powershell.exe).
 * Secrets nur via Env/Config, nie hardcodiert.
 */

export default (async ({ directory, $ }) => {
  const lastNotify = new Map<string, number>()
  const DEBOUNCE_MS = 30_000

  function shouldNotify(sessionID: string): boolean {
    const now = Date.now()
    const last = lastNotify.get(sessionID) ?? 0
    if (now - last < DEBOUNCE_MS) return false
    lastNotify.set(sessionID, now)
    return true
  }

  async function sendNotify(title: string, message: string) {
    // WSL → Windows Pfad konvertieren
    const isWsl = directory.startsWith("/mnt/")
    let notifyPath: string
    if (isWsl) {
      // /mnt/d/... -> D:\...
      const winPath = directory.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, "\\")
      notifyPath = `${winPath}\\notification\\notify.ps1`
      // In WSL: powershell.exe aufrufen
      try {
        await $`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${notifyPath}" -Title ${title} -Message ${message}`.quiet()
        return
      } catch {}
      // Fallback: pwsh
      try {
        await $`pwsh -NoProfile -ExecutionPolicy Bypass -File "${notifyPath}" -Title ${title} -Message ${message}`.quiet()
        return
      } catch {}
    } else {
      // Native Windows
      notifyPath = `${directory}/notification/notify.ps1`
      try {
        await $`powershell -NoProfile -ExecutionPolicy Bypass -File "${notifyPath}" -Title ${title} -Message ${message}`.quiet()
        return
      } catch {}
      try {
        await $`pwsh -NoProfile -ExecutionPolicy Bypass -File "${notifyPath}" -Title ${title} -Message ${message}`.quiet()
        return
      } catch {}
    }
  }

  return {
    // Allgemeiner Event-Hook — zuverlässigste Erkennung für Task-Ende
    // Opencode sendet Events für Session, Message, Tool etc.
    // Wir filtern auf session idle / message completed
    event: async ({ event }) => {
      // Event shape ist dynamisch, defensiv prüfen
      const e: any = event as any
      const type: string = e?.type ?? e?.event ?? ""
      const status: string = e?.status ?? e?.state ?? ""
      const sessionID: string = e?.sessionID ?? e?.sessionId ?? e?.properties?.sessionID ?? "default"

      // Heuristik: Session wird idle nach Agent fertig
      if (type.toLowerCase().includes("session") && (status.toLowerCase() === "idle" || status.toLowerCase() === "completed")) {
        if (shouldNotify(sessionID)) {
          await sendNotify("Muse Spark fertig", "Task wurde erfolgreich abgeschlossen.")
        }
      }
      // Alternative: Message completed vom Assistant
      if (type.toLowerCase().includes("message") && status.toLowerCase() === "completed" && e?.role === "assistant") {
        if (shouldNotify(sessionID + "_msg")) {
          // Nicht für jede Message, nur wenn Session danach idle — daher mildere Notification
          // Wir senden trotzdem, aber debounced
          // await sendNotify("Muse Spark fertig", "Antwort abgeschlossen.")
        }
      }
    },

    // Fallback: Wenn ein Task-Subagent fertig wird (tool = task)
    "tool.execute.after": async (input, _output) => {
      if (input.tool === "task") {
        // tool = task bedeutet Subagent fertig
        const sessionID = (input as any).sessionID ?? "task"
        if (shouldNotify(sessionID + "_task")) {
          await sendNotify("Muse Spark fertig", `Subagent Task abgeschlossen (${input.tool})`)
        }
      }
    },
  }
}) satisfies Plugin
