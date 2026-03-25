// src/components/StrategicNotes.js — Strategic Planning Notes & Call Recaps
// Shared notepad for leadership calls, strategic decisions, and meeting notes
// Data stored in Firebase at strategicNotes/

import React, { useState, useEffect, useRef } from "react";
import { db } from "../firebase";
import { ref, onValue, push, set, update, remove } from "firebase/database";

const PARTICIPANTS = [
  "Daniel Roscoe",
  "Matthew Toussaint",
  "Daniel Wollent",
  "Brian Karis",
];

const NOTE_TYPES = [
  { key: "call", label: "Call Recap", icon: "\u{1F4DE}" },
  { key: "strategy", label: "Strategic Decision", icon: "\u{1F3AF}" },
  { key: "market", label: "Market Intel", icon: "\u{1F4CA}" },
  { key: "action", label: "Action Items", icon: "\u26A1" },
  { key: "general", label: "General Note", icon: "\u{1F4DD}" },
];

const TYPE_COLORS = {
  call: "#3B82F6",
  strategy: "#C9A84C",
  market: "#22C55E",
  action: "#E87A2E",
  general: "#94A3B8",
};

export default function StrategicNotes() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedNote, setExpandedNote] = useState(null);

  // Form state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [noteType, setNoteType] = useState("call");
  const [participants, setParticipants] = useState([]);
  const [customParticipant, setCustomParticipant] = useState("");
  const [pinned, setPinned] = useState(false);
  const bodyRef = useRef();

  // Firebase listener
  useEffect(() => {
    const notesRef = ref(db, "strategicNotes");
    const unsub = onValue(notesRef, (snap) => {
      if (!snap.exists()) { setNotes([]); setLoading(false); return; }
      const data = snap.val();
      const arr = Object.entries(data).map(([id, n]) => ({ id, ...n }));
      arr.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      setNotes(arr);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const resetForm = () => {
    setTitle(""); setBody(""); setNoteType("call"); setParticipants([]); setCustomParticipant(""); setPinned(false);
    setComposing(false); setEditingId(null);
  };

  const handleSave = () => {
    if (!title.trim() && !body.trim()) return;
    const now = new Date().toISOString();
    const noteData = {
      title: title.trim(),
      body: body.trim(),
      type: noteType,
      participants,
      pinned,
      updatedAt: now,
    };

    if (editingId) {
      update(ref(db, `strategicNotes/${editingId}`), noteData);
    } else {
      noteData.createdAt = now;
      noteData.author = "Daniel Roscoe";
      push(ref(db, "strategicNotes"), noteData);
    }
    resetForm();
  };

  const handleEdit = (note) => {
    setTitle(note.title || "");
    setBody(note.body || "");
    setNoteType(note.type || "general");
    setParticipants(note.participants || []);
    setPinned(note.pinned || false);
    setEditingId(note.id);
    setComposing(true);
    setTimeout(() => bodyRef.current?.focus(), 100);
  };

  const handleDelete = (id) => {
    if (window.confirm("Delete this note permanently?")) {
      remove(ref(db, `strategicNotes/${id}`));
      if (expandedNote === id) setExpandedNote(null);
    }
  };

  const togglePin = (note) => {
    update(ref(db, `strategicNotes/${note.id}`), { pinned: !note.pinned });
  };

  const toggleParticipant = (name) => {
    setParticipants(prev => prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]);
  };

  const addCustomParticipant = () => {
    const name = customParticipant.trim();
    if (name && !participants.includes(name)) {
      setParticipants(prev => [...prev, name]);
    }
    setCustomParticipant("");
  };

  const filteredNotes = notes.filter(n => {
    if (filter !== "all" && n.type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (n.title || "").toLowerCase().includes(q) ||
             (n.body || "").toLowerCase().includes(q) ||
             (n.participants || []).some(p => p.toLowerCase().includes(q));
    }
    return true;
  });

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const diff = Date.now() - d;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const inp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(201,168,76,0.12)", fontSize: 13, outline: "none", background: "rgba(201,168,76,0.04)", color: "#E2E8F0", fontFamily: "'Inter', sans-serif" };
  const btnPrimary = { padding: "10px 20px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #E87A2E, #C9A84C)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: "0.02em" };
  const btnSecondary = { padding: "10px 20px", borderRadius: 10, border: "1px solid rgba(201,168,76,0.15)", background: "rgba(201,168,76,0.06)", color: "#C9A84C", fontSize: 13, fontWeight: 600, cursor: "pointer" };

  return (
    <div style={{ padding: "0" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#E2E8F0", letterSpacing: "0.02em" }}>
            Strategic Planning Notes
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6B7394" }}>
            Call recaps, strategic decisions & action items — shared across the team
          </p>
        </div>
        {!composing && (
          <button onClick={() => { resetForm(); setComposing(true); setTimeout(() => bodyRef.current?.focus(), 100); }} style={btnPrimary}>
            + New Note
          </button>
        )}
      </div>

      {/* Compose / Edit */}
      {composing && (
        <div style={{ background: "linear-gradient(135deg, #0F1538 0%, #0A0E24 100%)", borderRadius: 16, border: "1px solid rgba(201,168,76,0.15)", padding: "24px", marginBottom: 24, boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#C9A84C", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {editingId ? "Edit Note" : "New Strategic Note"}
          </div>

          {/* Note type */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {NOTE_TYPES.map(t => (
              <button key={t.key} onClick={() => setNoteType(t.key)} style={{
                padding: "6px 14px", borderRadius: 8, border: `1px solid ${noteType === t.key ? TYPE_COLORS[t.key] + "60" : "rgba(255,255,255,0.06)"}`,
                background: noteType === t.key ? TYPE_COLORS[t.key] + "20" : "rgba(255,255,255,0.03)",
                color: noteType === t.key ? TYPE_COLORS[t.key] : "#6B7394", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Title */}
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Note title — e.g. Q1 Strategy Call, PS Market Update..." style={{ ...inp, marginBottom: 12, fontWeight: 600, fontSize: 14 }} />

          {/* Body */}
          <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} placeholder="Meeting notes, key takeaways, decisions made, next steps..." rows={8} style={{ ...inp, minHeight: 160, resize: "vertical", lineHeight: 1.7, marginBottom: 16 }} />

          {/* Participants */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7394", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Participants</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {PARTICIPANTS.map(name => (
                <button key={name} onClick={() => toggleParticipant(name)} style={{
                  padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: participants.includes(name) ? "1px solid rgba(232,122,46,0.4)" : "1px solid rgba(255,255,255,0.06)",
                  background: participants.includes(name) ? "rgba(232,122,46,0.15)" : "rgba(255,255,255,0.03)",
                  color: participants.includes(name) ? "#E87A2E" : "#6B7394",
                }}>
                  {name}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={customParticipant} onChange={e => setCustomParticipant(e.target.value)} onKeyDown={e => e.key === "Enter" && addCustomParticipant()} placeholder="Add other participant..." style={{ ...inp, flex: 1, fontSize: 12 }} />
              {customParticipant.trim() && <button onClick={addCustomParticipant} style={{ ...btnSecondary, padding: "8px 14px", fontSize: 12 }}>Add</button>}
            </div>
            {participants.filter(p => !PARTICIPANTS.includes(p)).length > 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {participants.filter(p => !PARTICIPANTS.includes(p)).map(p => (
                  <span key={p} style={{ padding: "3px 10px", borderRadius: 6, background: "rgba(232,122,46,0.15)", color: "#E87A2E", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    {p}
                    <span onClick={() => setParticipants(prev => prev.filter(x => x !== p))} style={{ cursor: "pointer", opacity: 0.6 }}>&times;</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Pin toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 20, fontSize: 12, color: "#94A3B8" }}>
            <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} style={{ accentColor: "#C9A84C" }} />
            Pin to top
          </label>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleSave} style={btnPrimary}>{editingId ? "Update Note" : "Save Note"}</button>
            <button onClick={resetForm} style={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}

      {/* Filters & Search */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setFilter("all")} style={{
          padding: "5px 14px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
          border: filter === "all" ? "1px solid rgba(201,168,76,0.3)" : "1px solid rgba(255,255,255,0.06)",
          background: filter === "all" ? "rgba(201,168,76,0.12)" : "rgba(255,255,255,0.03)",
          color: filter === "all" ? "#C9A84C" : "#6B7394",
        }}>All</button>
        {NOTE_TYPES.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)} style={{
            padding: "5px 14px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
            border: filter === t.key ? `1px solid ${TYPE_COLORS[t.key]}40` : "1px solid rgba(255,255,255,0.06)",
            background: filter === t.key ? TYPE_COLORS[t.key] + "15" : "rgba(255,255,255,0.03)",
            color: filter === t.key ? TYPE_COLORS[t.key] : "#6B7394",
          }}>{t.icon} {t.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes..." style={{ ...inp, maxWidth: 220, fontSize: 12 }} />
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Total Notes", value: notes.length, color: "#C9A84C" },
          { label: "Call Recaps", value: notes.filter(n => n.type === "call").length, color: "#3B82F6" },
          { label: "Action Items", value: notes.filter(n => n.type === "action").length, color: "#E87A2E" },
          { label: "Pinned", value: notes.filter(n => n.pinned).length, color: "#22C55E" },
        ].map(s => (
          <div key={s.label} style={{ background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)", borderRadius: 10, padding: "12px 18px", border: "1px solid #334155", minWidth: 100 }}>
            <div style={{ fontSize: 9, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: s.color, marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Notes list */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#6B7394" }}>Loading notes...</div>
      ) : filteredNotes.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "#6B7394" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{"\u{1F4DD}"}</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{notes.length === 0 ? "No strategic notes yet" : "No notes match your filter"}</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>{notes.length === 0 ? "Click \"+ New Note\" to log your first call recap or strategic decision." : "Try adjusting your search or filter."}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredNotes.map(note => {
            const typeInfo = NOTE_TYPES.find(t => t.key === note.type) || NOTE_TYPES[4];
            const color = TYPE_COLORS[note.type] || TYPE_COLORS.general;
            const isExpanded = expandedNote === note.id;

            return (
              <div key={note.id} style={{
                background: "linear-gradient(135deg, #0F1538 0%, #0A0E24 100%)",
                borderRadius: 14, border: `1px solid ${note.pinned ? "rgba(201,168,76,0.25)" : "rgba(255,255,255,0.06)"}`,
                overflow: "hidden", transition: "all 0.2s",
                boxShadow: note.pinned ? "0 0 20px rgba(201,168,76,0.08)" : "none",
              }}>
                {/* Header */}
                <div onClick={() => setExpandedNote(isExpanded ? null : note.id)} style={{ padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 14 }}>
                  {/* Type badge */}
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, border: `1px solid ${color}30` }}>
                    {typeInfo.icon}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {note.pinned && <span style={{ fontSize: 10, color: "#C9A84C", fontWeight: 700, background: "rgba(201,168,76,0.12)", padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(201,168,76,0.2)" }}>PINNED</span>}
                      <span style={{ fontSize: 10, color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{typeInfo.label}</span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#E2E8F0", marginTop: 4, lineHeight: 1.4 }}>{note.title || "(Untitled)"}</div>
                    {!isExpanded && note.body && (
                      <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 4, lineHeight: 1.6, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {note.body}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {(note.participants || []).map(p => (
                        <span key={p} style={{ fontSize: 10, color: "#E87A2E", fontWeight: 600, background: "rgba(232,122,46,0.1)", padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(232,122,46,0.15)" }}>{p}</span>
                      ))}
                      <span style={{ fontSize: 10, color: "#6B7394", marginLeft: "auto" }}>{fmtDate(note.createdAt)}</span>
                      {note.updatedAt !== note.createdAt && <span style={{ fontSize: 10, color: "#475569" }}>(edited)</span>}
                    </div>
                  </div>

                  <div style={{ fontSize: 16, color: "#6B7394", transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s", flexShrink: 0, marginTop: 4 }}>{"\u25BC"}</div>
                </div>

                {/* Expanded body */}
                {isExpanded && (
                  <div style={{ padding: "0 20px 20px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ fontSize: 13, color: "#E2E8F0", lineHeight: 1.8, whiteSpace: "pre-wrap", padding: "16px 0" }}>
                      {note.body || "No content."}
                    </div>
                    <div style={{ display: "flex", gap: 8, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <button onClick={(e) => { e.stopPropagation(); handleEdit(note); }} style={{ ...btnSecondary, padding: "6px 14px", fontSize: 11 }}>Edit</button>
                      <button onClick={(e) => { e.stopPropagation(); togglePin(note); }} style={{ ...btnSecondary, padding: "6px 14px", fontSize: 11 }}>{note.pinned ? "Unpin" : "Pin"}</button>
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(note.id); }} style={{ padding: "6px 14px", borderRadius: 10, border: "1px solid rgba(220,38,38,0.15)", background: "rgba(220,38,38,0.06)", color: "#DC2626", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Delete</button>
                      <span style={{ flex: 1 }} />
                      {note.author && <span style={{ fontSize: 10, color: "#475569", alignSelf: "center" }}>by {note.author}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
