import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  BarController,
  LineController,
  DoughnutController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  Legend
} from "chart.js";

ChartJS.register(ArcElement, BarElement, BarController, LineController, DoughnutController, LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip, Legend);

// Dark theme defaults shared by every chart
ChartJS.defaults.color = "#94a3b8";
ChartJS.defaults.borderColor = "rgba(51, 65, 85, 0.35)";
ChartJS.defaults.font.family = "ui-sans-serif, system-ui, sans-serif";
ChartJS.defaults.font.size = 11;
ChartJS.defaults.plugins.legend.labels.boxWidth = 10;
ChartJS.defaults.plugins.legend.labels.boxHeight = 10;
ChartJS.defaults.plugins.tooltip.backgroundColor = "rgba(15, 23, 42, 0.95)";
ChartJS.defaults.plugins.tooltip.borderColor = "rgba(56, 189, 248, 0.3)";
ChartJS.defaults.plugins.tooltip.borderWidth = 1;
ChartJS.defaults.animation.duration = 500;

export const STATUS_COLORS = {
  Manufactured: "#38bdf8",
  "In Transit": "#fbbf24",
  Received: "#34d399",
  Depleted: "#64748b",
  Quarantined: "#fb923c",
  Recalled: "#f43f5e"
};

export const ANOMALY_COLORS = {
  "Cloned Unit Label": "#f43f5e",
  "Forged Unit Label": "#e11d48",
  "Unit Diversion": "#f59e0b",
  "Cold Chain Breach": "#fb923c",
  "Expired Product Active": "#a78bfa",
  "Suspicious Transaction Frequency": "#64748b",
  "Cache Divergence": "#475569",
  "Duplicate QR Code Scan": "#94a3b8"
};

export const doughnutOptions = {
  cutout: "68%",
  plugins: { legend: { position: "right" } },
  maintainAspectRatio: false
};

export const barOptions = (horizontal = false) => ({
  indexAxis: horizontal ? "y" : "x",
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: !horizontal }, ticks: { precision: 0 } },
    y: { grid: { display: horizontal ? false : true }, ticks: { precision: 0 } }
  }
});
