/**
 * Blackboard Dashboard TUI -- Real-time monitoring for gentle-cowork.
 *
 * Implements the design from design/blackboard-dashboard/01-main-dashboard.html
 * as a blessed-based terminal UI.
 */

import blessed from "blessed";
import type { Blackboard } from "./blackboard.ts";
import type { TaskContract, NodeRegistration, LeaseInfo } from "./types.ts";

export interface DashboardOptions {
  board: Blackboard;
  refreshIntervalMs?: number;
  nodeId?: string;
}

/** Color palette matching the artboard design */
const colors = {
  bg: "#1e1e2e",
  panelBg: "#1e1e2e",
  headerBg: "#181825",
  panelBorder: "#45475a",
  panelHeaderBg: "#313244",
  text: "#cdd6f4",
  textMuted: "#6c7086",
  title: "#f9e2af",
  accent: "#89b4fa",
  success: "#a6e3a1",
  warning: "#f9e2af",
  error: "#f38ba8",
  info: "#89b4fa",
  accent2: "#fab387",
  panelHeaderText: "#f9e2af",
};

/** Status badge colors */
const statusColors = {
  pending: { bg: "#45475a", fg: "#f9e2af" },
  in_progress: { bg: "#1e66f5", fg: "#cdd6f4" },
  completed: { bg: "#a6e3a1", fg: "#181825" },
  failed: { bg: "#f38ba8", fg: "#181825" },
};

export interface DashboardInstance {
  destroy: () => void;
  refresh: () => Promise<void>;
  togglePause: () => void;
}

export class BlackboardDashboard {
  declare screen: any;
  declare board: any;
  declare refreshIntervalMs: number;
  declare nodeId: string;
  declare headerBox: any;
  declare statusIndicators: any;
  declare contractsList: any;
  declare leasesList: any;
  declare fencesList: any;
  declare budgetBars: Map<string, { bar: any; valueText: any; limitText: any; limit: number }>;
  declare workersText: any;
  declare budgetText: any;
  declare clockText: any;
  declare paused: boolean;
  declare intervalId: NodeJS.Timeout | null;

  constructor(options: { board: any; refreshIntervalMs?: number; nodeId?: string }) {
    this.board = options.board;
    this.refreshIntervalMs = options.refreshIntervalMs ?? 2000;
    this.nodeId = options.nodeId ?? "dashboard";
    this.paused = false;
    this.intervalId = null;

    const blessed = require("blessed");
    this.screen = blessed.screen({
      smartCSR: true,
      title: "Gentle Cowork -- Blackboard Dashboard",
      fullUnicode: true,
      dockBorders: true,
      autoPadding: false,
    });

    this.setupUI();
    this.setupKeys();
    this.startRefresh();
  }

  private setupUI(): void {
    const blessed = require("blessed");

    this.screen.style.bg = "#1e1e2e";

    this.headerBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      border: { type: "line", fg: "#45475a" },
      style: { bg: "#181825", border: { fg: "#45475a" } },
    });

    blessed.text({
      parent: this.headerBox,
      top: 0,
      left: 2,
      content: "Gentle Cowork -- Blackboard Dashboard",
      style: { fg: "#f9e2af", bold: true },
    });

    blessed.text({
      parent: this.headerBox,
      top: 1,
      left: 2,
      content: "Real-time monitoring . Contracts . Leases . Fences . Budget",
      style: { fg: "#6c7086" },
    });

    this.statusIndicators = blessed.box({
      parent: this.headerBox,
      top: 0,
      right: 2,
      height: 2,
      width: "50%",
      align: "right",
      style: { bg: "#181825" },
    });

    this.clockText = blessed.text({
      parent: this.statusIndicators,
      top: 0,
      right: 0,
      content: "--:--:--",
      style: { fg: "#fab387", bold: true },
    });

    const leftWidth = "50%";
    const midWidth = "25%";
    const rightWidth = "25%";
    const topHeight = "65%";
    const bottomHeight = "35%";

    const contractsBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: "50%",
      height: "65%",
      border: { type: "line", fg: "#45475a" },
      label: " {bold}Contracts{/bold} ",
      style: { bg: "#1e1e2e", border: { fg: "#45475a" }, label: { fg: "#f9e2af" } },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
    });

    this.contractsList = blessed.list({
      parent: contractsBox,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      style: {
        item: { fg: "#cdd6f4", bg: "#1e1e2e" },
        selected: { fg: "#1e1e2e", bg: "#89b4fa", bold: true },
        scrollbar: { bg: "#45475a", fg: "#89b4fa" },
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: { ch: " ", track: { bg: "#45475a" } },
      items: [],
    });

    const leasesBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: "50%",
      width: "25%",
      height: "65%",
      border: { type: "line", fg: "#45475a" },
      label: " {bold}Active Leases{/bold} ",
      style: { bg: "#1e1e2e", border: { fg: "#45475a" }, label: { fg: "#f9e2af" } },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
    });

    this.leasesList = blessed.list({
      parent: leasesBox,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      style: {
        item: { fg: "#cdd6f4", bg: "#1e1e2e" },
        selected: { fg: "#1e1e2e", bg: "#89b4fa", bold: true },
        scrollbar: { bg: "#45475a", fg: "#89b4fa" },
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: { ch: " ", track: { bg: "#45475a" } },
      items: [],
    });

    const fencesBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: "75%",
      width: "25%",
      height: "65%",
      border: { type: "line", fg: "#45475a" },
      label: " {bold}Fence Registry{/bold} ",
      style: { bg: "#1e1e2e", border: { fg: "#45475a" }, label: { fg: "#f9e2af" } },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
    });

    this.fencesList = blessed.list({
      parent: fencesBox,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      style: {
        item: { fg: "#cdd6f4", bg: "#1e1e2e" },
        selected: { fg: "#1e1e2e", bg: "#89b4fa", bold: true },
        scrollbar: { bg: "#45475a", fg: "#89b4fa" },
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: { ch: " ", track: { bg: "#45475a" } },
      items: [],
    });

    const budgetBox = blessed.box({
      parent: this.screen,
      top: "68%",
      left: 0,
      right: 0,
      height: "35%",
      border: { type: "line", fg: "#45475a" },
      label: " {bold}Budget Usage{/bold} ",
      style: { bg: "#181825", border: { fg: "#45475a" }, label: { fg: "#f9e2af" } },
    });

    this.budgetBars = new Map();

    const budgetItems = [
      { key: "modelCalls", label: "Model Calls", limit: 100 },
      { key: "wallTime", label: "Wall Time", limit: 5 },
      { key: "tokens", label: "Tokens", limit: 20000 },
      { key: "events", label: "Events", limit: 50 },
    ];

    let leftPos = 2;
    for (const item of budgetItems) {
      blessed.text({
        parent: budgetBox,
        top: 1,
        left: leftPos,
        content: item.label,
        style: { fg: "#6c7086" },
      });

      const bar = blessed.progressbar({
        parent: budgetBox,
        top: 2,
        left: leftPos,
        width: 28,
        height: 1,
        orientation: "horizontal",
        style: { bar: { bg: "#a6e3a1" }, border: { fg: "#45475a" } },
        pch: "\u2588",
        filled: 0,
      });

      const valueText = blessed.text({
        parent: budgetBox,
        top: 3,
        left: leftPos,
        content: "0 / 0",
        style: { fg: "#cdd6f4", bold: true },
        width: 28,
        align: "right",
      });

      const limitText = blessed.text({
        parent: budgetBox,
        top: 4,
        left: leftPos,
        content: "(0%)",
        style: { fg: "#6c7086", bold: false },
        width: 28,
        align: "right",
      });

      this.budgetBars.set(item.key, { bar, valueText, limitText, limit: item.limit });
      leftPos += 32;
    }

    this.updateStatusIndicators();
    this.screen.render();
  }

  private setupKeys(): void {
    this.screen.on("keypress", (ch: string, key: any) => {
      if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
        this.destroy();
      } else if (key.name === "r") {
        this.refresh();
      } else if (key.name === "p") {
        this.togglePause();
      }
    });
  }

  private updateStatusIndicators(): void {
    const blessed = require("blessed");

    this.statusIndicators.destroy();

    this.statusIndicators = blessed.box({
      parent: this.headerBox,
      top: 0,
      right: 2,
      height: 2,
      width: "50%",
      align: "right",
      style: { bg: "#181825" },
    });

    blessed.text({
      parent: this.statusIndicators,
      top: 0,
      right: 0,
      content: "Master",
      style: { fg: "#a6e3a1" },
    });

    this.workersText = blessed.text({
      parent: this.statusIndicators,
      top: 0,
      right: 14,
      content: "Workers: --",
      style: { fg: "#89b4fa" },
    });

    this.budgetText = blessed.text({
      parent: this.statusIndicators,
      top: 1,
      right: 0,
      content: "Budget: --%",
      style: { fg: "#f9e2af" },
    });

    blessed.text({
      parent: this.statusIndicators,
      top: 1,
      right: 18,
      content: "Sync",
      style: { fg: "#a6e3a1" },
    });

    this.clockText = blessed.text({
      parent: this.statusIndicators,
      top: 1,
      right: 0,
      content: "--:--:--",
      style: { fg: "#fab387", bold: true },
    });
  }

  private async refresh(): Promise<void> {
    if (this.paused) return;

    try {
      this.board.refresh();
      this.updateContracts();
      this.updateLeases();
      this.updateFences();
      this.updateBudget();
      this.updateDynamicIndicators();
      this.updateClock();
      this.screen.render();
    } catch (error) {
      console.error("Dashboard refresh error:", error);
    }
  }

  private updateContracts(): void {
    const statusColors: any = {
      pending: { bg: "#45475a", fg: "#f9e2af" },
      in_progress: { bg: "#1e66f5", fg: "#cdd6f4" },
      completed: { bg: "#a6e3a1", fg: "#181825" },
      failed: { bg: "#f38ba8", fg: "#181825" },
    };

    const items = this.board.listContracts().map((c: any) => {
      const status = c.status;
      const statusColor = statusColors[status as keyof typeof statusColors] || { bg: "#45475a", fg: "#f9e2af" };
      const worker = c.workerNodeId || "\u2014";
      const fence = c.leaseFence ? `F:${c.leaseFence}` : "\u2014";
      return `{bold}${c.id}{/} {${statusColor.bg}-fg}${status.toUpperCase()}{/}  ${c.role.padEnd(10)}  ${c.workerNodeId || "\u2014".padEnd(16)}  ${c.leaseFence ? `F:${c.leaseFence}` : "\u2014"}`;
    });

    this.contractsList.setItems(items.length > 0 ? items : ["{gray-fg}(no contracts){/}"]);
    this.contractsList.setLabel(` {bold}Contracts{/} (${this.board.listContracts().length}) `);
  }

  private updateLeases(): void {
    const lease = this.board.getLease();
    const nodes = this.board.getNodes().filter((n: any) => n.role === "worker" && n.status === "alive");

    const contracts = this.board.listContracts().filter((c: any) => c.status === "in_progress" && c.workerNodeId);

    const items = contracts.map((c: any) => {
      const worker = nodes.find((n: any) => n.nodeId === c.workerNodeId);
      const leaseInfo = worker ? `F:${this.board.getLease()?.fence || "\u2014"}` : "no worker";
      const ttl = lease ? `${Math.max(0, Math.round((new Date(lease.expiresAt).getTime() - Date.now()) / 1000))}s` : "\u2014";
      const progress = lease ? Math.max(0, Math.min(100, 100 - (Date.now() - new Date(lease.acquiredAt).getTime()) / (lease.expiresAt - lease.acquiredAt) * 100)) : 0;
      const progressBar = "\u2588".repeat(Math.floor(progress / 5)) + "\u2591".repeat(20 - Math.floor(progress / 5));
      return `{bold}${c.id}{/} . ${c.workerNodeId || "\u2014"}  ${leaseInfo}  TTL:${ttl}  [${progressBar}]`;
    });

    this.leasesList.setItems(items.length > 0 ? items : ["{gray-fg}(no active leases){/}"]);
    this.leasesList.setLabel(` {bold}Active Leases{/} (${items.length}) `);
  }

  private updateFences(): void {
    const lease = this.board.getLease();
    const contracts = this.board.listContracts();

    const items = contracts.map((c: any) => {
      const fence = c.leaseFence ? `F:${c.leaseFence}` : "\u2014";
      const holder = c.workerNodeId || "\u2014";
      const status = c.status === "in_progress" ? "{green-fg}active{/}" :
                     c.status === "completed" ? "{green-fg}completed{/}" :
                     c.status === "failed" ? "{red-fg}failed{/}" : "{yellow-fg}pending{/}";
      const renewed = c.history.length > 1
        ? new Date(c.history[c.history.length - 1].timestamp).toLocaleTimeString()
        : "\u2014";
      return `{bold}${c.id}{/}  ${fence}  Holder:${holder}  ${status}  Renewed:${renewed}`;
    });

    this.fencesList.setItems(items.length > 0 ? items : ["{gray-fg}(no fences){/}"]);
    this.fencesList.setLabel(` {bold}Fence Registry{/} (${contracts.length}) `);
  }

  private updateBudget(): void {
    const totals = this.board.usageTotals();

    const updates: any = {
      modelCalls: { current: totals.modelCalls, limit: 100 },
      wallTime: { current: Math.round(totals.wallTimeMs / 3600000 * 10) / 10, limit: 5 },
      tokens: { current: totals.tokens ?? 0, limit: 20000 },
      events: { current: totals.events, limit: 50 },
    };

    for (const [key, data] of this.budgetBars) {
      const update = updates[key];
      if (update) {
        const pct = Math.min(100, (update.current / update.limit) * 100);
        data.bar.setProgress(pct);
        data.valueText.setContent(`${update.current} / ${update.limit}`);
        data.limitText.setContent(`(${Math.round(pct)}%)`);

        if (pct >= 90) {
          data.bar.style.bar.bg = "#f38ba8";
        } else if (pct >= 75) {
          data.bar.style.bar.bg = "#f9e2af";
        } else {
          data.bar.style.bar.bg = "#a6e3a1";
        }
      }
    }
  }

  private updateDynamicIndicators(): void {
    const nodes = this.board.getNodes().filter((n: any) => n.role === "worker" && n.status === "alive");
    this.workersText?.setContent(`Workers: ${nodes.length}`);

    const totals = this.board.usageTotals();
    const tokenPct = totals.tokens ? Math.round((totals.tokens / 20000) * 100) : 0;
    this.budgetText?.setContent(`Budget: ${tokenPct}%`);
    this.budgetText.style.fg = tokenPct >= 80 ? "#f38ba8" : tokenPct >= 60 ? "#f9e2af" : "#a6e3a1";
  }

  private updateClock(): void {
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    this.clockText?.setContent(time);
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.screen.render();
  }

  private startRefresh(): void {
    this.intervalId = setInterval(() => this.refresh(), this.refreshIntervalMs);
    this.refresh();
  }

  public destroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.screen.destroy();
    process.exit(0);
  }

  public static async run(board: any, options?: any): Promise<void> {
    const dashboard = new BlackboardDashboard({ board, ...options });
    await new Promise<void>((resolve) => {});
  }
}

export function createDashboard(board: any, options?: { refreshIntervalMs?: number; nodeId?: string }): any {
  return new BlackboardDashboard({ board, ...options });
}