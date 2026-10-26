import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Tag,
  Plus,
  Info,
  Edit2,
  AlertCircle,
  X,
} from "lucide-react";

export const CategoryManagementView: React.FC = () => {
  const queryClient = useQueryClient();

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [editingCategory, setEditingCategory] = useState<any | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState<string>("");
  const [trade, setTrade] = useState<string>("ELECTRICIAN");
  const [defaultDurationMin, setDefaultDurationMin] = useState<number>(45);
  const [slaMinutes, setSlaMinutes] = useState<number>(2880); // 48h
  const [defaultPriority, setDefaultPriority] = useState<string>("NORMAL");
  const [isActive, setIsActive] = useState<boolean>(true);

  // Fetch categories
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-categories"],
    queryFn: () => api.get<{ categories: any[] }>("/api/admin/categories"),
  });

  const categories = data?.categories || [];

  // Mutations
  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post("/api/admin/categories", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
      setIsAddModalOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.message || "Failed to create category");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string; data: any }) =>
      api.patch(`/api/admin/categories/${payload.id}`, payload.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-categories"] });
      setEditingCategory(null);
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.message || "Failed to update category");
    },
  });

  const resetForm = () => {
    setName("");
    setTrade("ELECTRICIAN");
    setDefaultDurationMin(45);
    setSlaMinutes(2880);
    setDefaultPriority("NORMAL");
    setIsActive(true);
    setFormError(null);
  };

  const openCreateModal = () => {
    resetForm();
    setIsAddModalOpen(true);
  };

  const openEditModal = (cat: any) => {
    setEditingCategory(cat);
    setName(cat.name);
    setTrade(cat.trade);
    setDefaultDurationMin(cat.defaultDurationMin);
    setSlaMinutes(cat.slaMinutes);
    setDefaultPriority(cat.defaultPriority);
    setIsActive(cat.isActive);
    setFormError(null);
  };

  const handleToggleActive = (cat: any) => {
    updateMutation.mutate({
      id: cat.id,
      data: { isActive: !cat.isActive },
    });
  };

  return (
    <div className="space-y-6">
      {/* Notice Banner */}
      <div className="bg-indigo-950/20 border border-indigo-500/30 rounded-2xl p-4 flex items-start gap-3 text-xs">
        <Info className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
        <div className="text-slate-300">
          <strong className="text-white font-semibold">Important Configuration Notice:</strong> Changes affect{" "}
          <strong className="text-indigo-300">new</strong> tickets only. Deactivating a category hides it from the student raise form, but existing tickets retain their historical category definition.
        </div>
      </div>

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Tag className="w-5 h-5 text-indigo-400" />
            <span>Issue Categories &amp; SLA Tuning</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure default duration predictions, trade routing associations, and SLA deadline targets.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-sm transition"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Category</span>
        </button>
      </div>

      {/* Categories Table */}
      {isLoading ? (
        <div className="p-16 flex flex-col items-center justify-center text-slate-400">
          <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-3" />
          <p className="text-xs">Loading categories...</p>
        </div>
      ) : error ? (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
          Failed to load issue categories.
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-semibold">Category Name</th>
                  <th className="py-3 px-4 font-semibold">Trade</th>
                  <th className="py-3 px-4 font-semibold">Default Priority</th>
                  <th className="py-3 px-4 font-semibold">Estimated Duration</th>
                  <th className="py-3 px-4 font-semibold">SLA Window</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {categories.map((cat: any) => (
                  <tr
                    key={cat.id}
                    className={`hover:bg-slate-800/30 transition-colors ${
                      !cat.isActive ? "opacity-60 bg-slate-950/40" : ""
                    }`}
                  >
                    <td className="py-3 px-4 font-semibold text-slate-200">
                      {cat.name}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase tracking-wider bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        {cat.trade}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase tracking-wider ${
                          cat.defaultPriority === "EMERGENCY"
                            ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                            : cat.defaultPriority === "URGENT"
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            : "bg-slate-800 text-slate-300 border border-slate-700"
                        }`}
                      >
                        {cat.defaultPriority}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {cat.defaultDurationMin} min
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {cat.slaMinutes >= 60
                        ? `${(cat.slaMinutes / 60).toFixed(1)} hrs`
                        : `${cat.slaMinutes} min`}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleToggleActive(cat)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition ${
                          cat.isActive
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25"
                            : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700"
                        }`}
                        title={cat.isActive ? "Click to deactivate (hide from students)" : "Click to activate"}
                      >
                        {cat.isActive ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => openEditModal(cat)}
                        className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition"
                        title="Edit category settings"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Category Modal */}
      {(isAddModalOpen || editingCategory) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-xs">
            <button
              onClick={() => {
                setIsAddModalOpen(false);
                setEditingCategory(null);
                resetForm();
              }}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <Tag className="w-4 h-4 text-indigo-400" />
              <span>{editingCategory ? "Edit Category" : "Create New Category"}</span>
            </h3>
            <p className="text-slate-400 mb-4">
              {editingCategory
                ? "Changes will apply to newly raised tickets only."
                : "Add a new maintenance issue category for student tickets."}
            </p>

            {formError && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (editingCategory) {
                  updateMutation.mutate({
                    id: editingCategory.id,
                    data: {
                      name,
                      trade,
                      defaultDurationMin: Number(defaultDurationMin),
                      slaMinutes: Number(slaMinutes),
                      defaultPriority,
                      isActive,
                    },
                  });
                } else {
                  createMutation.mutate({
                    name,
                    trade,
                    defaultDurationMin: Number(defaultDurationMin),
                    slaMinutes: Number(slaMinutes),
                    defaultPriority,
                    isActive,
                  });
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-slate-300 font-medium mb-1">Category Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Geyser heating failure"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Trade Specialization</label>
                  <select
                    value={trade}
                    onChange={(e) => setTrade(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none"
                  >
                    <option value="ELECTRICIAN">Electrician</option>
                    <option value="PLUMBER">Plumber</option>
                    <option value="CARPENTER">Carpenter</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Default Priority</label>
                  <select
                    value={defaultPriority}
                    onChange={(e) => setDefaultPriority(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none"
                  >
                    <option value="NORMAL">NORMAL</option>
                    <option value="URGENT">URGENT</option>
                    <option value="EMERGENCY">EMERGENCY</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Duration (5-480 min)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    required
                    value={defaultDurationMin}
                    onChange={(e) => setDefaultDurationMin(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    SLA (30-20160 min)
                  </label>
                  <input
                    type="number"
                    min={30}
                    max={20160}
                    required
                    value={slaMinutes}
                    onChange={(e) => setSlaMinutes(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="categoryIsActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-0"
                />
                <label htmlFor="categoryIsActive" className="text-slate-300 font-medium cursor-pointer">
                  Active (visible on student ticket raise form)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setEditingCategory(null);
                    resetForm();
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Saving..."
                    : editingCategory
                    ? "Update Category"
                    : "Create Category"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
