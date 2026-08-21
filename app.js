"use strict";

/* =========================================================
   Class Notes — 상태 관리 / localStorage 영속화 / 렌더링
   ========================================================= */

const STORAGE_KEY = "claude-class-notes:v1";
const THEME_KEY = "claude-class-notes:theme";
const SAVE_DEBOUNCE_MS = 400;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** @typedef {{id:string,title:string,order:number,createdAt:number}} Lecture */
/** @typedef {{id:string,lectureId:string|null,title:string,content:string,tags:string[],createdAt:number,updatedAt:number}} Note */

let state = {
  lectures: /** @type {Lecture[]} */ ([]),
  notes: /** @type {Note[]} */ ([]),
};

let ui = {
  filterType: "all", // 'all' | 'unfiled' | 'lecture'
  filterLectureId: /** @type {string|null} */ (null),
  search: "",
  view: "list", // 'list' | 'editor'
  activeNoteId: /** @type {string|null} */ (null),
};

let saveTimer = null;

/* ---------------- Utilities ---------------- */

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString("ko-KR", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------- Persistence ---------------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.lectures) && Array.isArray(parsed.notes)) {
      state = { lectures: parsed.lectures, notes: parsed.notes };
    }
  } catch (err) {
    console.error("노트 데이터를 불러오지 못했습니다.", err);
  }
}

function persistNow() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    flashSaveIndicator("저장됨");
  } catch (err) {
    console.error("저장 실패", err);
    flashSaveIndicator("저장 실패");
  }
}

const persistDebounced = debounce(persistNow, SAVE_DEBOUNCE_MS);

function flashSaveIndicator(text) {
  const el = document.getElementById("saveIndicator");
  if (!el) return;
  el.textContent = text;
  el.style.opacity = "1";
  clearTimeout(flashSaveIndicator._t);
  flashSaveIndicator._t = setTimeout(() => { el.style.opacity = "0.55"; }, 1200);
}

/* ---------------- Theme ---------------- */

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
}

function toggleTheme() {
  const isDarkNow = document.documentElement.getAttribute("data-theme") === "dark" ||
    (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  const next = isDarkNow ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
}

/* ---------------- Derived data ---------------- */

function notesForLecture(lectureId) {
  return state.notes.filter((n) => n.lectureId === lectureId);
}

function getFilteredNotes() {
  let list = state.notes;

  if (ui.search.trim()) {
    const q = ui.search.trim().toLowerCase();
    list = list.filter((n) =>
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q))
    );
  } else if (ui.filterType === "unfiled") {
    list = list.filter((n) => !n.lectureId);
  } else if (ui.filterType === "lecture") {
    list = list.filter((n) => n.lectureId === ui.filterLectureId);
  }

  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

function getLecture(id) {
  return state.lectures.find((l) => l.id === id) || null;
}

/* ---------------- Rendering: Sidebar ---------------- */

function renderSidebar() {
  document.getElementById("countAll").textContent = state.notes.length;
  document.getElementById("countUnfiled").textContent =
    state.notes.filter((n) => !n.lectureId).length;

  document.querySelectorAll(".nav-item[data-filter]").forEach((btn) => {
    const isActive = !ui.search && ui.filterType === btn.dataset.filter;
    btn.classList.toggle("active", isActive);
  });

  const listEl = document.getElementById("lectureList");
  const tpl = document.getElementById("lectureItemTemplate");
  listEl.innerHTML = "";

  const sorted = [...state.lectures].sort((a, b) => a.order - b.order);
  for (const lecture of sorted) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = lecture.id;
    node.classList.toggle(
      "active",
      !ui.search && ui.filterType === "lecture" && ui.filterLectureId === lecture.id
    );

    const btn = node.querySelector(".lecture-item-btn");
    btn.dataset.filter = "lecture";
    node.querySelector(".lecture-item-name").textContent = lecture.title;
    node.querySelector(".count").textContent = notesForLecture(lecture.id).length;

    btn.addEventListener("click", () => {
      ui.search = "";
      document.getElementById("searchInput").value = "";
      ui.filterType = "lecture";
      ui.filterLectureId = lecture.id;
      showListView();
    });

    node.querySelector('[data-action="rename"]').addEventListener("click", (e) => {
      e.stopPropagation();
      const name = prompt("회차 이름 변경", lecture.title);
      if (name && name.trim()) {
        lecture.title = name.trim();
        persistNow();
        renderAll();
      }
    });

    node.querySelector('[data-action="delete"]').addEventListener("click", (e) => {
      e.stopPropagation();
      const count = notesForLecture(lecture.id).length;
      const msg = count > 0
        ? `"${lecture.title}" 회차를 삭제할까요? 이 회차의 노트 ${count}개는 "미분류"로 이동합니다.`
        : `"${lecture.title}" 회차를 삭제할까요?`;
      if (!confirm(msg)) return;
      state.notes.forEach((n) => { if (n.lectureId === lecture.id) n.lectureId = null; });
      state.lectures = state.lectures.filter((l) => l.id !== lecture.id);
      if (ui.filterType === "lecture" && ui.filterLectureId === lecture.id) {
        ui.filterType = "all";
        ui.filterLectureId = null;
      }
      persistNow();
      renderAll();
    });

    listEl.appendChild(node);
  }
}

/* ---------------- Rendering: List view ---------------- */

function renderList() {
  const filtered = getFilteredNotes();

  const titleEl = document.getElementById("listTitle");
  const subtitleEl = document.getElementById("listSubtitle");
  const statsRow = document.getElementById("statsRow");

  if (ui.search.trim()) {
    titleEl.textContent = `"${ui.search.trim()}" 검색 결과`;
    subtitleEl.textContent = `${filtered.length}개의 노트를 찾았어요`;
    statsRow.hidden = true;
  } else if (ui.filterType === "unfiled") {
    titleEl.textContent = "미분류";
    subtitleEl.textContent = "아직 회차를 지정하지 않은 노트예요";
    statsRow.hidden = true;
  } else if (ui.filterType === "lecture") {
    const lecture = getLecture(ui.filterLectureId);
    titleEl.textContent = lecture ? lecture.title : "회차";
    subtitleEl.textContent = `${filtered.length}개의 노트`;
    statsRow.hidden = true;
  } else {
    titleEl.textContent = "전체 노트";
    subtitleEl.textContent = state.notes.length
      ? "지금까지 정리한 수업 내용이에요"
      : "아직 작성한 노트가 없어요";
    statsRow.hidden = false;
    document.getElementById("statTotalNotes").textContent = state.notes.length;
    document.getElementById("statLectures").textContent = state.lectures.length;
    const now = Date.now();
    document.getElementById("statWeek").textContent =
      state.notes.filter((n) => now - n.createdAt <= WEEK_MS).length;
  }

  const grid = document.getElementById("notesGrid");
  const empty = document.getElementById("emptyState");
  grid.innerHTML = "";

  if (filtered.length === 0) {
    grid.hidden = true;
    empty.hidden = false;
    empty.querySelector("h2").textContent = ui.search.trim()
      ? "검색 결과가 없어요"
      : "수업 노트를 남겨보세요";
    empty.querySelector("p").innerHTML = ui.search.trim()
      ? "다른 검색어로 다시 시도해보세요."
      : "수업 중 배운 내용을 기록하면 여기 자동으로 저장돼요.<br/>브라우저를 닫아도 사라지지 않아요.";
    return;
  }
  grid.hidden = false;
  empty.hidden = true;

  const tpl = document.getElementById("noteCardTemplate");
  for (const note of filtered) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    const lecture = note.lectureId ? getLecture(note.lectureId) : null;
    node.querySelector(".note-card-lecture").textContent = lecture ? lecture.title : "미분류";
    node.querySelector(".note-card-date").textContent = formatDate(note.updatedAt);
    node.querySelector(".note-card-title").textContent = note.title || "제목 없음";
    node.querySelector(".note-card-preview").textContent = note.content || "내용 없음";

    const tagsWrap = node.querySelector(".note-card-tags");
    note.tags.slice(0, 4).forEach((t) => {
      const span = document.createElement("span");
      span.textContent = t;
      tagsWrap.appendChild(span);
    });

    node.addEventListener("click", () => openEditor(note.id));
    grid.appendChild(node);
  }
}

/* ---------------- Rendering: Editor view ---------------- */

function populateLectureSelect(selectedId) {
  const select = document.getElementById("noteLecture");
  select.innerHTML = "";

  const unfiledOpt = document.createElement("option");
  unfiledOpt.value = "";
  unfiledOpt.textContent = "미분류";
  select.appendChild(unfiledOpt);

  const sorted = [...state.lectures].sort((a, b) => a.order - b.order);
  for (const lecture of sorted) {
    const opt = document.createElement("option");
    opt.value = lecture.id;
    opt.textContent = lecture.title;
    select.appendChild(opt);
  }
  select.value = selectedId || "";
}

function renderEditor() {
  const note = state.notes.find((n) => n.id === ui.activeNoteId);
  if (!note) return;

  document.getElementById("noteTitle").value = note.title;
  document.getElementById("noteContent").value = note.content;
  document.getElementById("noteTags").value = note.tags.join(", ");
  populateLectureSelect(note.lectureId);
  document.getElementById("editorTimestamp").textContent =
    `마지막 수정: ${formatDateTime(note.updatedAt)}`;
  flashSaveIndicator("저장됨");
}

/* ---------------- View switching ---------------- */

function showListView() {
  ui.view = "list";
  ui.activeNoteId = null;
  document.getElementById("listView").hidden = false;
  document.getElementById("editorView").hidden = true;
  renderAll();
}

function openEditor(noteId) {
  ui.view = "editor";
  ui.activeNoteId = noteId;
  document.getElementById("listView").hidden = true;
  document.getElementById("editorView").hidden = false;
  renderSidebar();
  renderEditor();
  document.getElementById("noteTitle").focus();
}

/* ---------------- Actions ---------------- */

function createNote() {
  const lectureId = ui.filterType === "lecture" ? ui.filterLectureId : null;
  const now = Date.now();
  const note = {
    id: uid(),
    lectureId,
    title: "",
    content: "",
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  state.notes.push(note);
  persistNow();
  openEditor(note.id);
}

function updateActiveNoteFromForm() {
  const note = state.notes.find((n) => n.id === ui.activeNoteId);
  if (!note) return;

  note.title = document.getElementById("noteTitle").value;
  note.content = document.getElementById("noteContent").value;
  note.tags = document
    .getElementById("noteTags").value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const lectureVal = document.getElementById("noteLecture").value;
  note.lectureId = lectureVal || null;
  note.updatedAt = Date.now();

  document.getElementById("editorTimestamp").textContent =
    `마지막 수정: ${formatDateTime(note.updatedAt)}`;
  flashSaveIndicator("저장 중…");
  persistDebounced();
}

function deleteActiveNote() {
  const note = state.notes.find((n) => n.id === ui.activeNoteId);
  if (!note) return;
  if (!confirm(`"${note.title || "제목 없음"}" 노트를 삭제할까요? 이 작업은 되돌릴 수 없어요.`)) return;
  state.notes = state.notes.filter((n) => n.id !== note.id);
  persistNow();
  showListView();
}

function addLecture() {
  const name = prompt("새 회차 이름을 입력하세요", `${state.lectures.length + 1}강`);
  if (!name || !name.trim()) return;
  const lecture = {
    id: uid(),
    title: name.trim(),
    order: state.lectures.length,
    createdAt: Date.now(),
  };
  state.lectures.push(lecture);
  persistNow();
  renderAll();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `class-notes-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!parsed || !Array.isArray(parsed.lectures) || !Array.isArray(parsed.notes)) {
        throw new Error("형식이 올바르지 않습니다.");
      }
      const merge = confirm(
        "가져오기 방식을 선택하세요.\n\n확인 = 기존 데이터에 이어붙이기\n취소 = 기존 데이터를 덮어쓰기"
      );
      if (merge) {
        state.lectures = [...state.lectures, ...parsed.lectures];
        state.notes = [...state.notes, ...parsed.notes];
      } else {
        state = { lectures: parsed.lectures, notes: parsed.notes };
      }
      persistNow();
      showListView();
    } catch (err) {
      alert("파일을 가져오지 못했어요: " + err.message);
    }
  };
  reader.readAsText(file);
}

/* ---------------- Wiring ---------------- */

function renderAll() {
  renderSidebar();
  if (ui.view === "list") renderList();
  else renderEditor();
}

function init() {
  initTheme();
  loadState();

  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
  document.getElementById("newNoteBtn").addEventListener("click", createNote);
  document.getElementById("emptyStateNewNote").addEventListener("click", createNote);
  document.getElementById("addLectureBtn").addEventListener("click", addLecture);

  document.querySelectorAll(".nav-item[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ui.search = "";
      document.getElementById("searchInput").value = "";
      ui.filterType = btn.dataset.filter;
      ui.filterLectureId = null;
      showListView();
    });
  });

  document.getElementById("searchInput").addEventListener("input", (e) => {
    ui.search = e.target.value;
    if (ui.view !== "list") showListView();
    else renderList();
    renderSidebar();
  });

  document.getElementById("backBtn").addEventListener("click", showListView);
  document.getElementById("deleteNoteBtn").addEventListener("click", deleteActiveNote);

  ["noteTitle", "noteContent", "noteTags", "noteLecture"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateActiveNoteFromForm);
  });
  document.getElementById("noteLecture").addEventListener("change", updateActiveNoteFromForm);

  document.getElementById("exportBtn").addEventListener("click", exportData);
  document.getElementById("importBtn").addEventListener("click", () =>
    document.getElementById("importFile").click()
  );
  document.getElementById("importFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importData(file);
    e.target.value = "";
  });

  document.addEventListener("keydown", (e) => {
    const isTypingField = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      document.getElementById("searchInput").focus();
    } else if (e.key === "Escape" && ui.view === "editor") {
      showListView();
    } else if (!isTypingField && e.key.toLowerCase() === "n") {
      createNote();
    }
  });

  showListView();
}

document.addEventListener("DOMContentLoaded", init);
