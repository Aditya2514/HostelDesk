import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Users,
  UserPlus,
  Calendar,
  AlertTriangle,
  AlertCircle,
  Plus,
  Trash2,
  X,
  Copy,
  Check,
  CheckCircle2,
} from "lucide-react";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Helper: Convert minutes from midnight (0..1440) to "HH:MM"
function minutesToTimeStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Helper: Convert "HH:MM" to minutes from midnight
function timeStrToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export const StaffManagementView: React.FC = () => {
  const queryClient = useQueryClient();

  // Modals state
  const [isAddStaffOpen, setIsAddStaffOpen] = useState<boolean>(false);
  const [newStaffName, setNewStaffName] = useState<string>("");
  const [newStaffEmail, setNewStaffEmail] = useState<string>("");
  const [newStaffTrade, setNewStaffTrade] = useState<string>("ELECTRICIAN");
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; tempPass: string } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Deactivation confirmation modal state
  const [deactivatingStaff, setDeactivatingStaff] = useState<any | null>(null);
  const [openTicketsToReassign, setOpenTicketsToReassign] = useState<any[]>([]);

  // Shift editor state
  const [editingShiftsStaff, setEditingShiftsStaff] = useState<any | null>(null);
  const [shiftWindows, setShiftWindows] = useState<{ weekday: number; startMinute: number; endMinute: number }[]>([]);
  const [shiftError, setShiftError] = useState<string | null>(null);

  // Fetch staff
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-staff"],
    queryFn: () => api.get<{ staff: any[] }>("/api/admin/staff"),
  });

  const staffList = data?.staff || [];

  // Mutations
  const addStaffMutation = useMutation({
    mutationFn: (payload: { name: string; email: string; trade: string }) =>
      api.post<{ staff: any; temporaryPassword: string }>("/api/admin/staff", payload),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin-staff"] });
      setCreatedCredentials({ email: res.staff.email, tempPass: res.temporaryPassword });
      setNewStaffName("");
      setNewStaffEmail("");
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: (payload: { staffId: string; isActive: boolean; reassignOpenTickets?: boolean }) =>
      api.patch(`/api/admin/staff/${payload.staffId}`, {
        isActive: payload.isActive,
        reassignOpenTickets: payload.reassignOpenTickets,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-staff"] });
      setDeactivatingStaff(null);
      setOpenTicketsToReassign([]);
    },
    onError: (err: any) => {
      if (err?.code === "HAS_OPEN_TICKETS" && err?.details?.openTickets) {
        setOpenTicketsToReassign(err.details.openTickets);
      }
    },
  });

  const updateShiftsMutation = useMutation({
    mutationFn: (payload: { staffId: string; shifts: any[] }) =>
      api.put(`/api/admin/staff/${payload.staffId}/shifts`, { shifts: payload.shifts }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-staff"] });
      setEditingShiftsStaff(null);
      setShiftWindows([]);
      setShiftError(null);
    },
    onError: (err: any) => {
      setShiftError(err?.message || "Failed to update shifts");
    },
  });

  // Handle active toggle
  const handleToggleActive = (staff: any) => {
    if (staff.isActive) {
      if (staff.openTicketCount > 0) {
        setDeactivatingStaff(staff);
        // Attempt normal deactivation; backend will return open tickets if any
        toggleStatusMutation.mutate({ staffId: staff.id, isActive: false });
      } else {
        toggleStatusMutation.mutate({ staffId: staff.id, isActive: false });
      }
    } else {
      toggleStatusMutation.mutate({ staffId: staff.id, isActive: true });
    }
  };

  // Open shift editor
  const openShiftEditor = (staff: any) => {
    setEditingShiftsStaff(staff);
    setShiftWindows(
      staff.shifts.map((s: any) => ({
        weekday: s.weekday,
        startMinute: s.startMinute,
        endMinute: s.endMinute,
      }))
    );
    setShiftError(null);
  };

  // Add shift window to day
  const handleAddWindow = (weekday: number) => {
    const existing = shiftWindows.filter((w) => w.weekday === weekday);
    if (existing.length >= 4) {
      setShiftError(`Maximum 4 windows allowed on ${WEEKDAYS[weekday]}`);
      return;
    }
    setShiftWindows([
      ...shiftWindows,
      { weekday, startMinute: 9 * 60, endMinute: 17 * 60 },
    ]);
  };

  // Remove shift window
  const handleRemoveWindow = (index: number) => {
    setShiftWindows(shiftWindows.filter((_, idx) => idx !== index));
  };

  // Update window time
  const handleUpdateTime = (index: number, field: "startMinute" | "endMinute", value: number) => {
    const updated = [...shiftWindows];
    updated[index][field] = value;
    setShiftWindows(updated);
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" />
            <span>Staff Roster &amp; Shift Management</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage hostel maintenance workforce, active states, open job reassignments, and weekly working shift windows.
          </p>
        </div>

        <button
          onClick={() => {
            setIsAddStaffOpen(true);
            setCreatedCredentials(null);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-sm transition"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Add Staff Member</span>
        </button>
      </div>

      {/* Staff Table */}
      {isLoading ? (
        <div className="p-16 flex flex-col items-center justify-center text-slate-400">
          <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-3" />
          <p className="text-xs">Loading staff workforce...</p>
        </div>
      ) : error ? (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
          Failed to load staff roster.
        </div>
      ) : staffList.length === 0 ? (
        <div className="p-12 text-center text-slate-400 bg-slate-900/40 rounded-xl border border-slate-800">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No maintenance staff found. Click "Add Staff Member" to onboard.</p>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-semibold">Staff Member</th>
                  <th className="py-3 px-4 font-semibold">Trade</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Open Jobs</th>
                  <th className="py-3 px-4 font-semibold">Weekly Shift Schedule</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {staffList.map((staff: any) => (
                  <tr key={staff.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-200">{staff.name}</div>
                      <div className="text-[11px] font-mono text-slate-400">{staff.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase tracking-wider bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        {staff.trade}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleToggleActive(staff)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition ${
                          staff.isActive
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25"
                            : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700"
                        }`}
                      >
                        {staff.isActive ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] ${
                          staff.openTicketCount > 0
                            ? "bg-amber-500/15 text-amber-300 border border-amber-500/20"
                            : "text-slate-400"
                        }`}
                      >
                        {staff.openTicketCount} jobs
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {staff.shifts.length === 0 ? (
                        <span className="text-slate-500 italic">No shifts set</span>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-sm">
                          {staff.shifts.slice(0, 4).map((s: any, idx: number) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700/60"
                            >
                              {WEEKDAYS[s.weekday].slice(0, 3)}: {minutesToTimeStr(s.startMinute)}-{minutesToTimeStr(s.endMinute)}
                            </span>
                          ))}
                          {staff.shifts.length > 4 && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              +{staff.shifts.length - 4} more
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => openShiftEditor(staff)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition ml-auto"
                      >
                        <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Edit Shifts</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Staff Modal */}
      {isAddStaffOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-xs">
            <button
              onClick={() => {
                setIsAddStaffOpen(false);
                setCreatedCredentials(null);
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-indigo-400" />
              <span>Add Maintenance Staff Member</span>
            </h3>
            <p className="text-slate-400 mb-4">
              Onboard a new technician. A temporary password will be generated for initial sign-in.
            </p>

            {createdCredentials ? (
              <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Account Created Successfully!</span>
                </div>
                <p className="text-slate-300">
                  Provide these credentials to the staff member. This temporary password will only be displayed once:
                </p>
                <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 font-mono text-xs flex items-center justify-between">
                  <div>
                    <div className="text-slate-400">Email: {createdCredentials.email}</div>
                    <div className="text-amber-400 font-bold mt-1">Password: {createdCredentials.tempPass}</div>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `Email: ${createdCredentials.email}\nPassword: ${createdCredentials.tempPass}`
                      );
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="p-2 hover:bg-slate-800 text-slate-300 rounded"
                    title="Copy credentials"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => {
                      setIsAddStaffOpen(false);
                      setCreatedCredentials(null);
                    }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  addStaffMutation.mutate({
                    name: newStaffName,
                    email: newStaffEmail,
                    trade: newStaffTrade,
                  });
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={newStaffName}
                    onChange={(e) => setNewStaffName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={newStaffEmail}
                    onChange={(e) => setNewStaffEmail(e.target.value)}
                    placeholder="e.g. ramesh.plumber@hostel.edu"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Trade Specialization</label>
                  <select
                    value={newStaffTrade}
                    onChange={(e) => setNewStaffTrade(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none"
                  >
                    <option value="ELECTRICIAN">Electrician</option>
                    <option value="PLUMBER">Plumber</option>
                    <option value="CARPENTER">Carpenter</option>
                  </select>
                </div>

                {addStaffMutation.isError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400">
                    {(addStaffMutation.error as any)?.message || "Failed to create staff account"}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsAddStaffOpen(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={addStaffMutation.isPending}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold disabled:opacity-50"
                  >
                    {addStaffMutation.isPending ? "Creating..." : "Create Staff Account"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Deactivation Reassignment Warning Modal */}
      {deactivatingStaff && openTicketsToReassign.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative text-xs">
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <span>Deactivate Staff: Open Tickets Detected</span>
            </h3>
            <p className="text-slate-300 mb-3">
              <strong className="text-white">{deactivatingStaff.name}</strong> currently has{" "}
              <strong className="text-amber-400">{openTicketsToReassign.length}</strong> active open ticket(s).
              Deactivation will automatically re-route each ticket to available active {deactivatingStaff.trade}s through the routing engine.
            </p>

            <div className="max-h-40 overflow-y-auto space-y-1.5 mb-4 p-2.5 bg-slate-950/60 rounded-xl border border-slate-800">
              {openTicketsToReassign.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-[11px] p-1.5 rounded bg-slate-900">
                  <span className="font-mono font-bold text-indigo-400">{t.code}</span>
                  <span className="text-slate-300 truncate max-w-xs">{t.title}</span>
                  <span className="font-mono text-[10px] text-slate-400 uppercase">{t.status}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeactivatingStaff(null);
                  setOpenTicketsToReassign([]);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  toggleStatusMutation.mutate({
                    staffId: deactivatingStaff.id,
                    isActive: false,
                    reassignOpenTickets: true,
                  })
                }
                disabled={toggleStatusMutation.isPending}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {toggleStatusMutation.isPending ? "Reassigning..." : "Reassign & Deactivate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Weekly Shift Editor Modal */}
      {editingShiftsStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl relative text-xs">
            <button
              onClick={() => {
                setEditingShiftsStaff(null);
                setShiftWindows([]);
                setShiftError(null);
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-400" />
              <span>Weekly Shift Rota: {editingShiftsStaff.name} ({editingShiftsStaff.trade})</span>
            </h3>
            <p className="text-slate-400 mb-4">
              Configure active duty hours per weekday. Windows must not overlap on the same day. Up to 4 windows per day.
            </p>

            {shiftError && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{shiftError}</span>
              </div>
            )}

            <div className="max-h-96 overflow-y-auto space-y-3 pr-1">
              {WEEKDAYS.map((dayName, weekday) => {
                const dayWindows = shiftWindows
                  .map((w, idx) => ({ ...w, originalIndex: idx }))
                  .filter((w) => w.weekday === weekday);

                return (
                  <div key={weekday} className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-slate-200">{dayName}</span>
                      <button
                        type="button"
                        onClick={() => handleAddWindow(weekday)}
                        className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Window</span>
                      </button>
                    </div>

                    {dayWindows.length === 0 ? (
                      <span className="text-[11px] text-slate-500 italic">Day off (no shifts)</span>
                    ) : (
                      <div className="space-y-2">
                        {dayWindows.map((win) => (
                          <div key={win.originalIndex} className="flex items-center gap-2">
                            <input
                              type="time"
                              value={minutesToTimeStr(win.startMinute)}
                              onChange={(e) =>
                                handleUpdateTime(
                                  win.originalIndex,
                                  "startMinute",
                                  timeStrToMinutes(e.target.value)
                                )
                              }
                              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 font-mono text-xs focus:outline-none"
                            />
                            <span className="text-slate-400">to</span>
                            <input
                              type="time"
                              value={minutesToTimeStr(win.endMinute)}
                              onChange={(e) =>
                                handleUpdateTime(
                                  win.originalIndex,
                                  "endMinute",
                                  timeStrToMinutes(e.target.value)
                                )
                              }
                              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 font-mono text-xs focus:outline-none"
                            />

                            <button
                              type="button"
                              onClick={() => handleRemoveWindow(win.originalIndex)}
                              className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded transition"
                              title="Delete shift window"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-slate-800 mt-4">
              <button
                type="button"
                onClick={() => setEditingShiftsStaff(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  updateShiftsMutation.mutate({
                    staffId: editingShiftsStaff.id,
                    shifts: shiftWindows,
                  })
                }
                disabled={updateShiftsMutation.isPending}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {updateShiftsMutation.isPending ? "Saving Shifts..." : "Save Shift Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
