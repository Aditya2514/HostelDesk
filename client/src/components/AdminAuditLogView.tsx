import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { History, ShieldCheck, ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { formatFriendlyIst } from "../lib/formatTime";

export const AdminAuditLogView: React.FC = () => {
  const [page, setPage] = useState<number>(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-audit-logs", page],
    queryFn: () => api.get<any>(`/api/admin/audit-log?page=${page}&limit=15`),
  });

  const logs = data?.logs || [];
  const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0 };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <History className="w-4 h-4 text-rose-400" />
            <span>Admin Mutation Audit Log</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Immutable log of all administrative actions (occupancy moves, staff updates, shift edits, category changes)
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {isLoading ? (
        <div className="p-16 flex flex-col items-center justify-center text-slate-400">
          <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-3" />
          <p className="text-xs">Loading audit events...</p>
        </div>
      ) : isError ? (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
          Failed to load audit logs. Please retry.
        </div>
      ) : logs.length === 0 ? (
        <div className="p-12 text-center text-slate-400 bg-slate-900/40 rounded-xl border border-slate-800">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-slate-500" />
          <p className="text-sm">No administrative audit records logged yet.</p>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-semibold">Timestamp (IST)</th>
                  <th className="py-3 px-4 font-semibold">Action</th>
                  <th className="py-3 px-4 font-semibold">Entity Type</th>
                  <th className="py-3 px-4 font-semibold">Admin Actor</th>
                  <th className="py-3 px-4 font-semibold">Audit Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">
                      {formatFriendlyIst(log.createdAt)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {log.entityType}
                    </td>
                    <td className="py-3 px-4 text-slate-200">
                      <div className="font-medium">{log.actor?.name || "Admin"}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{log.actor?.email}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-400 max-w-md truncate">
                      {log.payload ? JSON.stringify(log.payload) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-slate-800 text-xs">
              <span className="text-slate-400">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} records)
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
