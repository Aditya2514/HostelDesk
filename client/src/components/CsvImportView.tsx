import React, { useState, useRef } from "react";
import { api } from "../lib/api";
import {
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Download,
  AlertCircle,
  RotateCcw,
} from "lucide-react";

interface CsvRowResult {
  rowIndex: number;
  email: string;
  name: string;
  block: string;
  room: string;
  fromDate: string;
  status: "CREATE" | "MOVE" | "UNCHANGED" | "ERROR";
  errorReason?: string;
}

export const CsvImportView: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<{
    rows: CsvRowResult[];
    hasErrors: boolean;
    summary: { total: number; create: number; move: number; unchanged: number; error: number };
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{
    summary: { total: number; create: number; move: number; unchanged: number };
    credentialsCsv: string;
    credentials: { email: string; temporaryPassword: string }[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setPreviewData(null);
      setApplyResult(null);
      setErrorMsg(null);
    }
  };

  const handlePreview = async () => {
    if (!file) return;
    setIsPreviewing(true);
    setErrorMsg(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.upload<any>("/api/admin/import/students?mode=preview", formData);
      setPreviewData(res);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to parse CSV preview");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!file || !previewData || previewData.hasErrors) return;
    setIsApplying(true);
    setErrorMsg(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.upload<any>("/api/admin/import/students?mode=apply", formData);
      setApplyResult(res);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to apply student import");
    } finally {
      setIsApplying(false);
    }
  };

  const handleDownloadCredentials = () => {
    if (!applyResult?.credentialsCsv) return;
    const blob = new Blob([applyResult.credentialsCsv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `student_credentials_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const resetAll = () => {
    setFile(null);
    setPreviewData(null);
    setApplyResult(null);
    setErrorMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      {/* Upload & Actions Bar */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Upload className="w-5 h-5 text-indigo-400" />
              <span>Bulk Student &amp; Occupancy CSV Import</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Two-step atomic import: parse &amp; validate preview first, then apply all-or-nothing with temporary credentials generation.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
              Columns: email, name, block, room, fromDate
            </span>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Upload Drop/Input */}
        {!applyResult && (
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-indigo-400 hover:file:bg-slate-700 bg-slate-950/60 p-1.5 rounded-xl border border-slate-800 cursor-pointer"
            />

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                disabled={!file || isPreviewing}
                onClick={handlePreview}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-sm transition disabled:opacity-40 whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{isPreviewing ? "Validating..." : "Preview CSV"}</span>
              </button>

              {previewData && (
                <button
                  type="button"
                  disabled={previewData.hasErrors || isApplying}
                  onClick={handleApply}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-sm transition disabled:opacity-30 whitespace-nowrap"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{isApplying ? "Applying..." : "Apply Import"}</span>
                </button>
              )}

              {file && (
                <button
                  type="button"
                  onClick={resetAll}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl text-xs transition"
                  title="Clear file"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Applied Result / Credentials Download Box */}
      {applyResult && (
        <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-6 shadow-lg shadow-emerald-500/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-base mb-1">
                <CheckCircle2 className="w-5 h-5" />
                <span>Import Successfully Applied!</span>
              </div>
              <p className="text-xs text-slate-300">
                Created: <strong className="text-emerald-400">{applyResult.summary.create}</strong> students, Moved: <strong className="text-indigo-400">{applyResult.summary.move}</strong> students, Unchanged: <strong>{applyResult.summary.unchanged}</strong>.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadCredentials}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition"
              >
                <Download className="w-4 h-4" />
                <span>Download Credentials (CSV)</span>
              </button>
              <button
                type="button"
                onClick={resetAll}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium"
              >
                Done / New Import
              </button>
            </div>
          </div>

          {applyResult.credentials.length > 0 && (
            <div className="mt-4 p-4 bg-slate-900/80 rounded-xl border border-slate-800 text-xs">
              <div className="font-semibold text-slate-200 mb-2">
                Temporary Credentials for {applyResult.credentials.length} New Students (Passwords are stored as bcrypt hashes and shown here only once):
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-[11px]">
                {applyResult.credentials.map((c, idx) => (
                  <div key={idx} className="flex items-center justify-between py-1 px-2 rounded bg-slate-950/60 border border-slate-800/80">
                    <span className="text-slate-300">{c.email}</span>
                    <span className="text-amber-400 font-bold">{c.temporaryPassword}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Preview Table & Summary */}
      {previewData && !applyResult && (
        <div className="space-y-4">
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
              <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Total Rows</div>
              <div className="text-lg font-bold text-white mt-0.5">{previewData.summary.total}</div>
            </div>
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
              <div className="text-[10px] text-emerald-400 font-medium uppercase tracking-wider">Create (New)</div>
              <div className="text-lg font-bold text-emerald-400 mt-0.5">{previewData.summary.create}</div>
            </div>
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
              <div className="text-[10px] text-indigo-400 font-medium uppercase tracking-wider">Move (Room Change)</div>
              <div className="text-lg font-bold text-indigo-400 mt-0.5">{previewData.summary.move}</div>
            </div>
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
              <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Unchanged</div>
              <div className="text-lg font-bold text-slate-300 mt-0.5">{previewData.summary.unchanged}</div>
            </div>
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
              <div className="text-[10px] text-rose-400 font-medium uppercase tracking-wider">Errors</div>
              <div className="text-lg font-bold text-rose-400 mt-0.5">{previewData.summary.error}</div>
            </div>
          </div>

          {previewData.hasErrors && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                Import cannot be applied because {previewData.summary.error} row(s) contain validation errors. Fix the CSV file and re-upload.
              </span>
            </div>
          )}

          {/* Table */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-semibold w-12">#</th>
                    <th className="py-3 px-4 font-semibold">Email</th>
                    <th className="py-3 px-4 font-semibold">Name</th>
                    <th className="py-3 px-4 font-semibold">Block &amp; Room</th>
                    <th className="py-3 px-4 font-semibold">From Date</th>
                    <th className="py-3 px-4 font-semibold">Action Status</th>
                    <th className="py-3 px-4 font-semibold">Reason / Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {previewData.rows.map((row) => (
                    <tr
                      key={row.rowIndex}
                      className={`hover:bg-slate-800/30 transition-colors ${
                        row.status === "ERROR" ? "bg-rose-500/5" : ""
                      }`}
                    >
                      <td className="py-2.5 px-4 font-mono text-slate-400">{row.rowIndex}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-200">{row.email}</td>
                      <td className="py-2.5 px-4 font-medium text-slate-300">{row.name}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-300">
                        Block {row.block} - Room {row.room}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-400">{row.fromDate}</td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase tracking-wider ${
                            row.status === "CREATE"
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                              : row.status === "MOVE"
                              ? "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20"
                              : row.status === "UNCHANGED"
                              ? "bg-slate-500/15 text-slate-400 border border-slate-500/20"
                              : "bg-rose-500/15 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-xs">
                        {row.errorReason ? (
                          <span className="text-rose-400 font-medium">{row.errorReason}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
