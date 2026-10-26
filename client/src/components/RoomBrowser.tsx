import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  DoorClosed,
  UserMinus,
  ArrowRightLeft,
  Filter,
  AlertCircle,
  X,
} from "lucide-react";

export const RoomBrowser: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedBlockId, setSelectedBlockId] = useState<string>("");
  const [selectedFloor, setSelectedFloor] = useState<string>("");

  // Modals state
  const [movingStudent, setMovingStudent] = useState<any | null>(null);
  const [targetRoomId, setTargetRoomId] = useState<string>("");
  const [moveError, setMoveError] = useState<string | null>(null);

  const [endingOccupancy, setEndingOccupancy] = useState<any | null>(null);
  const [endError, setEndError] = useState<string | null>(null);

  // Student directory search for quick moves
  const [studentSearch, setStudentSearch] = useState<string>("");
  const [isMoveModalOpen, setIsMoveModalOpen] = useState<boolean>(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  // Fetch rooms
  const { data: roomsData, isLoading: isRoomsLoading, error: roomsError } = useQuery({
    queryKey: ["admin-rooms", selectedBlockId, selectedFloor],
    queryFn: () => {
      const p = new URLSearchParams();
      if (selectedBlockId) p.set("blockId", selectedBlockId);
      if (selectedFloor) p.set("floor", selectedFloor);
      return api.get<{ rooms: any[] }>(`/api/admin/rooms?${p.toString()}`);
    },
  });

  // Fetch student search results for move modal
  const { data: studentsData } = useQuery({
    queryKey: ["admin-students-search", studentSearch],
    queryFn: () => {
      const p = new URLSearchParams({ limit: "10" });
      if (studentSearch.trim()) p.set("search", studentSearch.trim());
      return api.get<{ students: any[] }>(`/api/admin/students?${p.toString()}`);
    },
    enabled: isMoveModalOpen,
  });

  // Move mutation
  const moveMutation = useMutation({
    mutationFn: (payload: { userId: string; roomId: string }) =>
      api.post("/api/admin/occupancy/move", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-rooms"] });
      queryClient.invalidateQueries({ queryKey: ["admin-students-search"] });
      setIsMoveModalOpen(false);
      setMovingStudent(null);
      setSelectedUserId("");
      setTargetRoomId("");
      setMoveError(null);
    },
    onError: (err: any) => {
      setMoveError(err?.message || "Failed to move student");
    },
  });

  // End occupancy mutation
  const endMutation = useMutation({
    mutationFn: (occupancyId: string) =>
      api.post(`/api/admin/occupancy/${occupancyId}/end`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-rooms"] });
      queryClient.invalidateQueries({ queryKey: ["admin-students-search"] });
      setEndingOccupancy(null);
      setEndError(null);
    },
    onError: (err: any) => {
      setEndError(err?.message || "Failed to end occupancy");
    },
  });

  const rooms = roomsData?.rooms || [];

  // Extract unique blocks & floors from rooms for filters
  const blocks = Array.from(new Set(rooms.map((r: any) => JSON.stringify({ id: r.blockId, name: r.blockName })))).map(
    (s: any) => JSON.parse(s)
  );
  const floors = Array.from(new Set(rooms.map((r: any) => r.floor))).sort((a: any, b: any) => a - b);

  return (
    <div className="space-y-6">
      {/* Controls & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs text-slate-400 font-medium">Block:</span>
            <select
              value={selectedBlockId}
              onChange={(e) => setSelectedBlockId(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
            >
              <option value="">All Blocks</option>
              {blocks.map((b: any) => (
                <option key={b.id} value={b.id}>
                  Block {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Floor:</span>
            <select
              value={selectedFloor}
              onChange={(e) => setSelectedFloor(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
            >
              <option value="">All Floors</option>
              {floors.map((f: any) => (
                <option key={f} value={f}>
                  Floor {f}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={() => {
            setIsMoveModalOpen(true);
            setMoveError(null);
          }}
          className="flex items-center gap-2 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-sm transition"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>Move / Assign Student</span>
        </button>
      </div>

      {/* Rooms Grid */}
      {isRoomsLoading ? (
        <div className="p-16 flex flex-col items-center justify-center text-slate-400">
          <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-3" />
          <p className="text-xs">Loading rooms &amp; occupancy status...</p>
        </div>
      ) : roomsError ? (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
          Failed to load rooms. Please refresh the page.
        </div>
      ) : rooms.length === 0 ? (
        <div className="p-12 text-center text-slate-400 bg-slate-900/40 rounded-xl border border-slate-800">
          <DoorClosed className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">No rooms found for selected filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((room: any) => (
            <div
              key={room.id}
              className={`p-4 rounded-xl border transition-all ${
                room.isFull
                  ? "bg-slate-900/80 border-slate-800"
                  : room.occupantCount === 1
                  ? "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                  : "bg-slate-900/40 border-slate-800/60 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-white">
                    Room {room.number}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    (Block {room.blockName}, F{room.floor})
                  </span>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                    room.occupantCount === 2
                      ? "bg-rose-500/15 text-rose-400 border border-rose-500/20"
                      : room.occupantCount === 1
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                      : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                  }`}
                >
                  {room.occupantCount} / 2 Occupants
                </span>
              </div>

              {room.occupantCount === 0 ? (
                <div className="py-4 text-center text-slate-400 text-xs italic">
                  Vacant room (ready for assignment)
                </div>
              ) : (
                <div className="space-y-2">
                  {room.currentOccupants.map((occ: any) => (
                    <div
                      key={occ.occupancyId}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-800/50 text-xs"
                    >
                      <div className="overflow-hidden pr-2">
                        <div className="font-medium text-slate-200 truncate">{occ.name}</div>
                        <div className="text-[10px] text-slate-400 truncate">{occ.email}</div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => {
                            setMovingStudent({
                              userId: occ.userId,
                              name: occ.name,
                              currentRoom: `${room.blockName}-${room.number}`,
                            });
                            setSelectedUserId(occ.userId);
                            setIsMoveModalOpen(true);
                          }}
                          className="p-1 hover:bg-slate-700 text-slate-400 hover:text-indigo-300 rounded"
                          title="Move student to another room"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEndingOccupancy(occ)}
                          className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded"
                          title="End occupancy (move out)"
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Move Student Modal */}
      {isMoveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-xs">
            <button
              onClick={() => {
                setIsMoveModalOpen(false);
                setMoveError(null);
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-indigo-400" />
              <span>Move / Assign Student</span>
            </h3>
            <p className="text-slate-400 mb-4">
              Atomically terminates current room occupancy and registers student in new room. Maximum 2 occupants per room.
            </p>

            {moveError && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{moveError}</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Select Student</label>
                {movingStudent ? (
                  <div className="p-2.5 bg-slate-800 rounded-lg text-slate-200">
                    <span className="font-semibold">{movingStudent.name}</span>{" "}
                    <span className="text-slate-400">(Current: {movingStudent.currentRoom})</span>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      placeholder="Search student by name or email..."
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 mb-2 focus:outline-none"
                    />
                    <select
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                    >
                      <option value="">-- Choose student --</option>
                      {studentsData?.students?.map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.email}) {s.currentRoom ? `[Room ${s.currentRoom.blockName}-${s.currentRoom.roomNumber}]` : "[No room]"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Target Room</label>
                <select
                  value={targetRoomId}
                  onChange={(e) => setTargetRoomId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                >
                  <option value="">-- Choose destination room --</option>
                  {rooms
                    .filter((r: any) => !r.isFull)
                    .map((r: any) => (
                      <option key={r.id} value={r.id}>
                        Block {r.blockName} - Room {r.number} (Floor {r.floor}) [{r.occupantCount}/2 occupants]
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsMoveModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const userId = movingStudent?.userId || selectedUserId;
                    if (!userId || !targetRoomId) {
                      setMoveError("Please select both a student and destination room.");
                      return;
                    }
                    moveMutation.mutate({ userId, roomId: targetRoomId });
                  }}
                  disabled={moveMutation.isPending}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {moveMutation.isPending ? "Moving..." : "Confirm Move"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* End Occupancy Modal */}
      {endingOccupancy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative text-xs">
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <UserMinus className="w-4 h-4 text-rose-400" />
              <span>End Occupancy (Move Out)</span>
            </h3>
            <p className="text-slate-300 mb-4">
              Are you sure you want to end occupancy for <span className="font-semibold text-white">{endingOccupancy.name}</span>? They will no longer have access to room tickets.
            </p>

            {endError && (
              <div className="mb-4 p-2 bg-rose-500/10 border border-rose-500/20 rounded text-rose-400">
                {endError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEndingOccupancy(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => endMutation.mutate(endingOccupancy.occupancyId)}
                disabled={endMutation.isPending}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold disabled:opacity-50"
              >
                {endMutation.isPending ? "Ending..." : "End Occupancy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
