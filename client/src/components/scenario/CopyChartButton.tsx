import { useRef, useState, type ReactNode } from "react";
import { toPng } from "html-to-image";
import { Copy, Check, Download } from "lucide-react";

interface CopyChartButtonProps {
  children: ReactNode;
  fileName?: string;
}

/**
 * Wraps a chart and provides copy-to-clipboard and download-as-PNG buttons.
 * The entire child area (including title) is captured.
 */
export default function CopyChartButton({
  children,
  fileName = "chart",
}: CopyChartButtonProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const capture = async (): Promise<Blob | null> => {
    if (!chartRef.current) return null;
    const dataUrl = await toPng(chartRef.current, {
      backgroundColor: "#ffffff",
      pixelRatio: 2,
    });
    const res = await fetch(dataUrl);
    return res.blob();
  };

  const handleCopy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await capture();
      if (!blob) return;
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await capture();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative group">
      <div ref={chartRef}>{children}</div>

      {/* Action buttons — visible on hover */}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          disabled={busy}
          title="Kopier til utklippstavle"
          className="p-1.5 rounded-md bg-white/90 border border-gray-200 shadow-sm
                     hover:bg-gray-50 text-gray-500 hover:text-gray-700
                     disabled:opacity-50 cursor-pointer transition-colors"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-600" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          onClick={handleDownload}
          disabled={busy}
          title="Last ned som PNG"
          className="p-1.5 rounded-md bg-white/90 border border-gray-200 shadow-sm
                     hover:bg-gray-50 text-gray-500 hover:text-gray-700
                     disabled:opacity-50 cursor-pointer transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
