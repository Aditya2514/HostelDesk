import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/Header";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { StatusBadge, PriorityBadge } from "../components/StatusBadge";
import {
  PlusCircle,
  Home,
  Users,
  MapPin,
  AlertCircle,
  CheckCircle2,
  X,
} from "lucide-react";

export const StudentDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [locationType, setLocationType] = useState<"ROOM" | "COMMON">("ROOM");
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [floor, setFloor] = useState<number>(3);
  const [commonSpot, setCommonSpot] = useState("");

  const [activeTab, setActiveTab] = useState<"ROOM" | "COMMON">("ROOM");

  // Duplicate error state
  const [duplicateRoomError, setDuplicateRoomError] = useState<{
    message: string;
    existingTicketId?: string;
    existingTicketCode?: string;
  } | null>(null);
  const [similarTicketsModal, setSimilarTicketsModal] = useState<{
    tickets: Array<{ id: string; code: string; title: string; commonSpot: string; followerCount: number }>;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Fetch active categories
  const { data: catData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<{ categories: any[] }>("/api/categories"),
  });
  const categories = catData?.categories ?? [];

  // Fetch tickets for student
  const { data: ticketsData, isLoading: isTicketsLoading } = useQuery({
    queryKey: ["student-tickets"],
    queryFn: () => api.get<{ tickets: any[] }>("/api/tickets?limit=50"),
  });

  const tickets = ticketsData?.tickets ?? [];
  const roomTickets = tickets.filter((t) => t.locationType === "ROOM");
  const commonTickets = tickets.filter((t) => t.locationType === "COMMON");

  // Create ticket mutation
  const createMutation = useMutation({
    mutationFn: (data: any) => api.post("/api/tickets", data),
    onSuccess: (res: any) => {
      setShowModal(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["student-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      navigate(`/tickets/${res.ticket.id}`);
    },
    onError: (err: any) => {
      const similar = err.details?.similarTickets || err.similarTickets;
      if (err.code === "DUPLICATE_ROOM_TICKET") {
        setDuplicateRoomError({
          message: err.message,
          existingTicketId: err.details?.existingTicketId,
          existingTicketCode: err.details?.existingTicketCode,
        });
      } else if (err.code === "SIMILAR_TICKETS_EXIST" && similar && similar.length > 0) {
        setSimilarTicketsModal({ tickets: similar });
      } else {
        setFormError(err.message || "Failed to create ticket");
      }
    },
  });

  // Join mutation
  const joinMutation = useMutation({
    mutationFn: (ticketId: string) => api.post(`/api/tickets/${ticketId}/follow`),
    onSuccess: (_res, ticketId) => {
      setSimilarTicketsModal(null);
      setShowModal(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["student-tickets"] });
      navigate(`/tickets/${ticketId}`);
    },
  });

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setCategoryId(categories[0]?.id || "");
    setCommonSpot("");
    setDuplicateRoomError(null);
    setSimilarTicketsModal(null);
    setFormError(null);
  };

  const handleCreateSubmit = (forceCreateAnyway = false) => {
    setFormError(null);
    setDuplicateRoomError(null);

    createMutation.mutate({
      locationType,
      categoryId: categoryId || categories[0]?.id,
      title,
      description,
      floor: locationType === "COMMON" ? floor : undefined,
      commonSpot: locationType === "COMMON" ? commonSpot : undefined,
      joinExistingCheck: !forceCreateAnyway,
    });
  };

  const selectedCategory = categories.find((c) => c.id === (categoryId || categories[0]?.id));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome & Room Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 mb-8 relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
            <div>
              <span className="text-xs font-semibold text-indigo-400 tracking-wider uppercase mb-1 block">
                Student Resident Portal
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Welcome back, {user?.name.split(" ")[0]}!
              </h1>
              <p className="text-slate-400 text-sm mt-1 flex items-center space-x-2">
                <Home className="w-4 h-4 text-indigo-400" />
                <span>
                  Occupant of{" "}
                  <strong className="text-slate-200">
                    {user?.currentRoom?.displayName || "Room A-301"}
                  </strong>{" "}
                  (Floor {user?.currentRoom?.floor || "3"})
                </span>
              </p>
            </div>

            <button
              onClick={() => {
                resetForm();
                setShowModal(true);
              }}
              className="inline-flex items-center justify-center space-x-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition"
            >
              <PlusCircle className="w-5 h-5" />
              <span>Raise Issue</span>
            </button>
          </div>
        </div>

        {/* Tab selection */}
        <div className="flex border-b border-slate-800 mb-6">
          <button
            onClick={() => setActiveTab("ROOM")}
            className={`pb-3 px-4 text-sm font-semibold border-b-2 transition flex items-center space-x-2 ${
              activeTab === "ROOM"
                ? "border-indigo-500 text-white"
                : "border-transparent text-slate-400 hover:text-slate-300"
            }`}
          >
            <Home className="w-4 h-4" />
            <span>My Room's Tickets ({roomTickets.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("COMMON")}
            className={`pb-3 px-4 text-sm font-semibold border-b-2 transition flex items-center space-x-2 ${
              activeTab === "COMMON"
                ? "border-indigo-500 text-white"
                : "border-transparent text-slate-400 hover:text-slate-300"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Common Area Complaints ({commonTickets.length})</span>
          </button>
        </div>

        {/* Ticket List */}
        {isTicketsLoading ? (
          <div className="py-16 flex justify-center">
            <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        ) : (activeTab === "ROOM" ? roomTickets : commonTickets).length === 0 ? (
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center">
            <CheckCircle2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white mb-1">
              No active {activeTab === "ROOM" ? "room" : "common area"} complaints
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mb-6">
              {activeTab === "ROOM"
                ? "Everything in your room is currently running smoothly! Tap 'Raise Issue' if anything needs repair."
                : "No common area complaints reported by you or followed on your floor."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(activeTab === "ROOM" ? roomTickets : commonTickets).map((ticket) => (
              <div
                key={ticket.id}
                onClick={() => navigate(`/tickets/${ticket.id}`)}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 p-5 rounded-2xl cursor-pointer transition shadow-lg hover:shadow-indigo-500/5 group flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-xs font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                      {ticket.code}
                    </span>
                    <StatusBadge status={ticket.status} />
                  </div>

                  <h3 className="text-base font-bold text-white group-hover:text-indigo-400 transition mb-2">
                    {ticket.title}
                  </h3>

                  <p className="text-xs text-slate-400 line-clamp-2 mb-4 leading-relaxed">
                    {ticket.description}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                  <div className="flex items-center space-x-1.5">
                    <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                    <span>
                      {ticket.locationType === "ROOM"
                        ? `${ticket.block?.name}-${ticket.room?.number}`
                        : `Floor ${ticket.floor} (${ticket.commonSpot})`}
                    </span>
                  </div>
                  <PriorityBadge priority={ticket.priority} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Raise Issue Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-2xl overflow-y-auto max-h-[90vh]">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-white">Raise Hostel Complaint</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Tickets are automatically routed to the available trade staff
                  </p>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1 text-slate-500 hover:text-slate-300 rounded-lg hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {formError && (
                <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Roommate duplicate error notice */}
              {duplicateRoomError && (
                <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs rounded-xl">
                  <div className="flex items-center space-x-2 font-bold mb-1">
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                    <span>Your roommate already reported this!</span>
                  </div>
                  <p className="text-slate-300 mb-3">{duplicateRoomError.message}</p>
                  <div className="flex items-center space-x-2">
                    {duplicateRoomError.existingTicketId && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowModal(false);
                          navigate(`/tickets/${duplicateRoomError.existingTicketId}`);
                        }}
                        className="px-3 py-1.5 bg-amber-500 text-slate-950 hover:bg-amber-400 rounded-lg font-bold text-xs transition"
                      >
                        View Ticket {duplicateRoomError.existingTicketCode ? `(${duplicateRoomError.existingTicketCode})` : ""}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setShowModal(false);
                        setActiveTab("ROOM");
                      }}
                      className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded-lg font-semibold text-xs transition"
                    >
                      All Room Complaints
                    </button>
                  </div>
                </div>
              )}

              {/* Location Toggle */}
              <div className="mb-5">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Complaint Location
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-800/80 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setLocationType("ROOM")}
                    className={`py-2 text-xs font-semibold rounded-lg transition flex items-center justify-center space-x-2 ${
                      locationType === "ROOM"
                        ? "bg-indigo-600 text-white shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Home className="w-4 h-4" />
                    <span>My Room ({user?.currentRoom?.displayName || "A-301"})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLocationType("COMMON")}
                    className={`py-2 text-xs font-semibold rounded-lg transition flex items-center justify-center space-x-2 ${
                      locationType === "COMMON"
                        ? "bg-indigo-600 text-white shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span>Common Area</span>
                  </button>
                </div>
              </div>

              {/* Category Selector */}
              <div className="mb-5">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Issue Category
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.trade} · Usually fixed within {Math.round(c.slaMinutes / 60)}h)
                    </option>
                  ))}
                </select>
                {selectedCategory && (
                  <div className="mt-2 flex items-center space-x-2 text-[11px] text-slate-400">
                    <span>Priority: </span>
                    <PriorityBadge priority={selectedCategory.defaultPriority} />
                    <span>· Duration: ~{selectedCategory.defaultDurationMin} min</span>
                  </div>
                )}
              </div>

              {/* Common Area Specific Fields */}
              {locationType === "COMMON" && (
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">
                      Floor
                    </label>
                    <select
                      value={floor}
                      onChange={(e) => setFloor(parseInt(e.target.value))}
                      className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                    >
                      <option value={1}>Floor 1</option>
                      <option value={2}>Floor 2</option>
                      <option value={3}>Floor 3</option>
                      <option value={4}>Floor 4</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-400 mb-1">
                      Common Spot (e.g. Washroom 3A)
                    </label>
                    <input
                      type="text"
                      maxLength={60}
                      value={commonSpot}
                      onChange={(e) => setCommonSpot(e.target.value)}
                      placeholder="e.g. Floor 2 East Washroom"
                      className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500"
                    />
                  </div>
                </div>
              )}

              {/* Title with counter */}
              <div className="mb-5">
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-semibold text-slate-400">Title</label>
                  <span className="text-[10px] text-slate-500">{title.length} / 100</span>
                </div>
                <input
                  type="text"
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Main ceiling fan not spinning at all"
                  className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500"
                />
              </div>

              {/* Description with counter */}
              <div className="mb-6">
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-semibold text-slate-400">Description</label>
                  <span className="text-[10px] text-slate-500">{description.length} / 1000</span>
                </div>
                <textarea
                  rows={4}
                  maxLength={1000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide helpful details (e.g. switch makes spark sound when pressed)..."
                  className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 leading-relaxed"
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateSubmit(false)}
                  disabled={
                    title.trim().length < 5 ||
                    description.trim().length < 10 ||
                    (locationType === "COMMON" && commonSpot.trim().length < 2) ||
                    createMutation.isPending
                  }
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
                >
                  {createMutation.isPending ? "Submitting..." : "Submit Ticket"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Similar Common Tickets Modal (Join or Create Anyway) */}
        {similarTicketsModal && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
              <div className="flex items-center space-x-2 text-indigo-400 mb-2">
                <AlertCircle className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">Similar Issues Already Reported</h3>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Students on this floor have recently reported similar issues in this area within the last 2 hours. You can join their complaint to receive instant updates or create a separate ticket anyway.
              </p>

              <div className="space-y-3 mb-6 max-h-64 overflow-y-auto">
                {similarTicketsModal.tickets.map((t) => (
                  <div
                    key={t.id}
                    className="p-3.5 bg-slate-800/60 rounded-xl border border-slate-700/60 flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs font-bold text-slate-300">{t.code}</span>
                        <span className="text-[10px] text-slate-400">· {t.commonSpot}</span>
                      </div>
                      <div className="text-xs font-semibold text-white mt-0.5">{t.title}</div>
                      <span className="text-[10px] text-indigo-400 mt-1 block">
                        {t.followerCount} student{t.followerCount === 1 ? "" : "s"} already following
                      </span>
                    </div>

                    <button
                      onClick={() => joinMutation.mutate(t.id)}
                      disabled={joinMutation.isPending}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow transition"
                    >
                      Join
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                <button
                  onClick={() => setSimilarTicketsModal(null)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleCreateSubmit(true)}
                  disabled={createMutation.isPending}
                  className="text-xs text-slate-300 hover:text-white font-semibold underline underline-offset-4"
                >
                  Create Separate Ticket Anyway
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
